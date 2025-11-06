/**
 * AgentGmail.gs
 * Gmail監視 → Discord通知（複数ルール & 既読化＋スター＋任意ラベル）
 * v1.5 (設定外部化 & モデル修正対応版)
 *
 * シート構成:
 * - 検索条件: [GMAIL_QUERY, DiscordWebhook, MentionID, ApplyLabel]
 * - 設定: [Key, Value]
 * - TIMEZONE, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_MODEL_FALLBACKS, MAX_THREADS_PER_RULE, SUMMARY_PROMPT_BASE
 * - Log: [日付, タイトル, 要約結果, 処理結果, スレッドID, メッセージID, ルール行, GMAIL_QUERY]
 * - ラベル管理: [MentionID, LabelName]  // A=MentionID, B=LabelName
 */

// ===== メニュー =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Gmail管理')
    .addItem('🧱 初期化', 'initSheets')
    .addItem('📄 ルール追加（簡易）', 'addRuleWithWizard')
    .addSeparator()
    .addItem('🧪 設定テスト', 'testConfig')
    .addItem('🧪 要約テスト（手動）', 'testCreateSummary_')
    .addItem('🧪 モデル一覧（ログ出力）', 'listGeminiModels_')
    .addItem('🔍 手動チェック', 'runOnce')
    .addSeparator()
    .addItem('⚙️ トリガー設定（毎時）', 'setupTriggerHourly')
    .addItem('❌ トリガー削除', 'deleteTrigger')
    .addToUi();
}

// ===== 初期化 =====
function initSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 検索条件（複数ルール行）
  let ruleSheet = ss.getSheetByName('検索条件');
  if (!ruleSheet) {
    ruleSheet = ss.insertSheet('検索条件');
    const headers = ['GMAIL_QUERY','DiscordWebhook','MentionID','ApplyLabel'];
    ruleSheet.getRange(1,1,1,headers.length).setValues([headers]);
    ruleSheet.setFrozenRows(1);
    ruleSheet.setColumnWidth(1, 520);
    ruleSheet.setColumnWidth(2, 620);
    ruleSheet.setColumnWidth(3, 220);
    ruleSheet.setColumnWidth(4, 260);
    // 参考例 (メールアドレス変更: c-machida@ma.livable.jp -> madomori@aicu.ai)
    ruleSheet.appendRow([
      'from:madomori@aicu.ai is:unread',
      'https://discord.com/api/webhooks/xxxxxxxx/xxxxxxxx',
      '',
      'Sales/Machida'
    ]);
  }

  // 設定（任意）
  let setSheet = ss.getSheetByName('設定');
  if (!setSheet) {
    setSheet = ss.insertSheet('設定');
    setSheet.getRange(1,1,1,2).setValues([['Key','Value']]);
    const defaults = [
      ['TIMEZONE',''], // 空ならスクリプトのTZ
      ['GEMINI_API_KEY',''], // 任意
      // 優先モデル（2.x系）
      ['GEMINI_MODEL','models/gemini-2.0-flash'],
      // フォールバック候補（左から順に試す）※ 1.5系は除外
      ['GEMINI_MODEL_FALLBACKS','models/gemini-2.0-pro,models/gemini-2.0-flash-lite'],
      ['MAX_THREADS_PER_RULE','30'], // ルールごとの検索上限
      // 要約プロンプトベース (SUMMARY_PROMPT_BASE 追加)
      ['SUMMARY_PROMPT_BASE','以下のメールを日本語で100文字以内に1行要約。装飾や箇条書きなしで。返信が必要か、いつまでに必要かを明記して。']
    ];
    setSheet.getRange(2,1,defaults.length,2).setValues(defaults);
    setSheet.setFrozenRows(1);
    setSheet.setColumnWidths(1,2,320);
  }

  // Log
  let logSheet = ss.getSheetByName('Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('Log');
    const headers = ['日付','タイトル','要約結果','処理結果','スレッドID','メッセージID','ルール行','GMAIL_QUERY'];
    logSheet.getRange(1,1,1,headers.length).setValues([headers]);
    logSheet.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#E8F0FE');
    logSheet.setFrozenRows(1);
    logSheet.setColumnWidths(1, headers.length, 240);
    logSheet.setColumnWidth(2, 360);
    logSheet.setColumnWidth(3, 420);
    logSheet.setColumnWidth(8, 560);
  }

  // ラベル管理（A: MentionID / B: LabelName）
  let mapSheet = ss.getSheetByName('ラベル管理');
  if (!mapSheet) {
    mapSheet = ss.insertSheet('ラベル管理');
    mapSheet.getRange(1,1,1,2).setValues([['MentionID','LabelName']]);
    mapSheet.setFrozenRows(1);
    mapSheet.setColumnWidth(1, 260); // MentionID
    mapSheet.setColumnWidth(2, 340); // LabelName
    // 例
    mapSheet.appendRow(['402600831465029633','Sales/Machida']);
  }

  SpreadsheetApp.getUi().alert('初期化完了', '「検索条件」「設定」「Log」「ラベル管理」を準備しました。ルールを追加・編集してください。', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ===== ルール追加（簡易UI） =====
function addRuleWithWizard() {
  const ui = SpreadsheetApp.getUi();

  // メールアドレスの例を変更: c-machida@ma.livable.jp -> madomori@aicu.ai
  const from = promptOrCancel_(ui, '送信者（From）', '例: madomori@aicu.ai（空でも可）'); if (from === null) return;
  const subj = promptOrCancel_(ui, '件名に含むキーワード', '例: 請求, 契約, 完了（カンマ区切り/空可）'); if (subj === null) return;
  const unread = confirmYesNo_(ui, '未読メールだけに限定しますか？');
  const hasAtt = confirmYesNo_(ui, '添付ありメールだけに限定しますか？');
  const days = promptOrCancel_(ui, '対象期間（日数）', '例: 7（空なら指定なし）'); if (days === null) return;

  const parts = [];
  if (from) parts.push(`from:${from.trim()}`);
  if (subj) {
    const words = subj.split(',').map(s => s.trim()).filter(Boolean);
    if (words.length === 1) parts.push(`subject:${quoteIfSpace_(words[0])}`);
    if (words.length > 1) parts.push(`subject:(${words.map(quoteIfSpace_).join(' OR ')})`);
  }
  if (unread) parts.push('is:unread');
  if (hasAtt) parts.push('has:attachment');
  if (days && /^\d+$/.test(days.trim())) parts.push(`newer_than:${days.trim()}d`);
  if (parts.length === 0) parts.push('label:inbox');

  const query = parts.join(' ');
  const webhook = promptOrCancel_(ui, 'Discord Webhook URL', 'https://discord.com/api/webhooks/...'); if (webhook === null) return;
  if (!/^https:\/\/discord\.com\/api\/webhooks\//.test(webhook)) {
    ui.alert('エラー', 'Discord Webhook URLの形式が正しくありません。', ui.ButtonSet.OK);
    return;
  }
  const mention = promptOrCancel_(ui, 'MentionID（任意）', '例: 402600831465029633（空OK）'); if (mention === null) return;
  const applyLabel = promptOrCancel_(ui, 'ApplyLabel（任意）', '例: Sales/Machida（空OK）'); if (applyLabel === null) return;

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('検索条件');
  sh.appendRow([query, webhook.trim(), (mention||'').trim(), (applyLabel||'').trim()]);
  ui.alert('追加完了', `下記クエリでルールを追加しました：\n\n${query}`, ui.ButtonSet.OK);
}

function promptOrCancel_(ui, title, body) {
  const r = ui.prompt(title, body, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() === ui.Button.CANCEL) return null;
  return (r.getResponseText() || '').trim();
}
function confirmYesNo_(ui, title) {
  const r = ui.alert(title, ui.ButtonSet.YES_NO);
  return r === ui.Button.YES;
}
function quoteIfSpace_(s){ return /\s/.test(s) ? `"${s}"` : s; }

// ===== 実行（手動/トリガー） =====
function runOnce() {
  try {
    scanAllRules_();
    SpreadsheetApp.getUi().alert('完了', '実行が完了しました。DiscordとLogを確認してください。', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    console.error(e);
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
function cronHourly() {
  try { scanAllRules_(); }
  catch (e) { console.error('cronHourly error:', e); }
}

// すべてのルールを処理
function scanAllRules_() {
  const cfg = loadSettings_();
  const tz = cfg.TIMEZONE || Session.getScriptTimeZone();

  // 既処理メッセージID（重複防止）
  const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Log');
  const doneIds = new Set();
  const lv = logSheet.getDataRange().getValues();
  for (let i=1; i<lv.length; i++) {
    const mid = lv[i][5];
    if (mid) doneIds.add(String(mid));
  }

  // ルール行を取得
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('検索条件');
  const v = sh.getDataRange().getValues();
  if (v.length <= 1) return;

  const maxPerRule = Math.max(1, Number(cfg.MAX_THREADS_PER_RULE || 30));
  let processed = 0;

  for (let r=1; r<v.length; r++) {
    const query = (v[r][0] || '').toString().trim();
    const webhook = (v[r][1] || '').toString().trim();
    const mentionIdFromRule = (v[r][2] || '').toString().trim();
    const applyLabel = (v[r][3] || '').toString().trim();
    if (!query || !/^https:\/\/discord\.com\/api\/webhooks\//.test(webhook)) continue;

    // MentionID 補完（ルール空 & ApplyLabel あり → ラベル管理から）
    const mentionId = mentionIdFromRule || (applyLabel ? resolveMentionFromLabel_(applyLabel) : '');

    const threads = GmailApp.search(query, 0, maxPerRule);
    for (const th of threads) {
      const msgs = th.getMessages();
      for (const msg of msgs) {
        const mid = msg.getId();
        if (doneIds.has(mid)) continue;

        const subject = msg.getSubject() || '(件名なし)';
        const fromStr = formatFrom_(msg.getFrom());
        const body = sanitize_(msg.getPlainBody() || '').trim();

        // 要約実行
        const summary = createSummary_(subject, body, cfg) || (body ? body.slice(0, 100) : '(本文なし)');

        const header = '[執事AI]';
        const mentionLine = mentionId ? `<@${mentionId}> さま\n\n` : '';
        const threadUrl = `https://mail.google.com/mail/u/0/#inbox/${th.getId()}`;
        const content =
`${header}

${mentionLine}"${fromStr}"よりご連絡です

${codeBlock_(summary)}

---
件名：${subject}
プレビュー：
${codeBlock_(body.slice(0, 600))}

🔗 Gmail: ${threadUrl}
`;

        const resCode = sendDiscord_(webhook, content);

        // 通知後の後処理：既読化 + スター + 任意ラベル付与
        msg.markRead();
        msg.star();
        if (applyLabel) {
          const label = getOrCreateLabel_(applyLabel);
          th.addLabel(label);
        }

        const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
        logSheet.appendRow([now, subject, summary, `Discord:${resCode}`, th.getId(), mid, r+1, query]);

        doneIds.add(mid);
        processed++;
      }
    }
  }
  console.log(`処理完了: ${processed}件`);
}

// ===== 設定ロード =====
function loadSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const set = ss.getSheetByName('設定');
  const out = {};
  if (set) {
    const v = set.getDataRange().getValues();
    for (let i=1; i<v.length; i++) {
      const k = (v[i][0] || '').toString().trim();
      const val = (v[i][1] || '').toString();
      if (k) out[k] = val;
    }
  }
  return {
    TIMEZONE: out['TIMEZONE'] || '',
    GEMINI_API_KEY: out['GEMINI_API_KEY'] || '',
    GEMINI_MODEL: out['GEMINI_MODEL'] || 'models/gemini-2.0-flash',
    GEMINI_MODEL_FALLBACKS: (out['GEMINI_MODEL_FALLBACKS'] || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    MAX_THREADS_PER_RULE: out['MAX_THREADS_PER_RULE'] || '30',
    // SUMMARY_PROMPT_BASE を追加
    SUMMARY_PROMPT_BASE: out['SUMMARY_PROMPT_BASE'] || '以下のメールを日本語で100文字以内に1行要約。装飾や箇条書きなしで。',
  };
}

// ===== 要約（Gemini + API & バージョン・モデル フォールバック / 簡易100文字） =====
function createSummary_(subject, body, cfg) {
  const fallback = simpleSummary_(subject, body);

  const key = (cfg && cfg.GEMINI_API_KEY) ? String(cfg.GEMINI_API_KEY).trim() : '';
  if (!key) return fallback;

  const models = [
    (cfg && cfg.GEMINI_MODEL) ? String(cfg.GEMINI_MODEL).trim() : 'models/gemini-2.0-flash',
    ...(cfg && Array.isArray(cfg.GEMINI_MODEL_FALLBACKS) ? cfg.GEMINI_MODEL_FALLBACKS : [])
  ].filter(Boolean);

  // プロンプトベースを設定から取得 (SUMMARY_PROMPT_BASE の使用)
  const defaultPrompt = '以下のメールを日本語で100文字以内に1行要約。装飾や箇条書きなしで。';
  const promptBase = cfg.SUMMARY_PROMPT_BASE || defaultPrompt;

  const prompt = [
    promptBase,
    `件名: ${subject || ''}`,
    '---',
    (body || '').slice(0, 5000)
  ].join('\n');

  // エンドポイントのバージョンもフォールバック（v1 → v1beta）
  const apiVersions = ['v1', 'v1beta'];

  for (const model of models) {
    for (const ver of apiVersions) {
      try {
        const resText = callGemini_(model, key, prompt, ver);
        if (!resText) continue;
        const out = String(resText).trim().slice(0, 100);
        if (out) return out;
      } catch (e) {
        console.warn(`Gemini call failed on ${ver}/${model}:`, e && e.message ? e.message : e);
        // 次の ver または次の model へ
      }
    }
  }
  return fallback;
}

// 簡易要約：改行除去 → 空白正規化 → 100文字
function simpleSummary_(subject, body) {
  const merged = (`${subject || ''} ${body || ''}`)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return merged.slice(0, 100) || '(本文なし)';
}

// ===== Gemini 呼び出し（Generative Language API, v1 / v1beta） =====
function callGemini_(model, apiKey, promptText, apiVersion) {
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [{ parts: [{ text: promptText }]}],
    generationConfig: { temperature: 0.2, maxOutputTokens: 128 },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const text = res.getContentText();

  if (Math.floor(code / 100) !== 2) {
    throw new Error(`HTTP ${code}: ${text && text.slice ? text.slice(0, 300) : text}`);
  }

  let out = '';
  const data = JSON.parse(text);
  if (data && data.candidates && data.candidates.length > 0) {
    const c0 = data.candidates[0];
    const parts = c0 && c0.content && c0.content.parts;
    if (parts && parts.length > 0 && typeof parts[0].text === 'string') {
      out = parts[0].text;
    } else if (typeof c0.output === 'string') {
      out = c0.output; // 互換表現
    }
  }
  return out;
}

// ===== モデル一覧（デバッグ用） =====
function listGeminiModels_() {
  const cfg = loadSettings_();
  const key = (cfg && cfg.GEMINI_API_KEY) ? String(cfg.GEMINI_API_KEY).trim() : '';
  if (!key) {
    SpreadsheetApp.getUi().alert('APIキー未設定', '設定シートに GEMINI_API_KEY を設定してください。', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  // まず v1、失敗なら v1beta
  const versions = ['v1', 'v1beta'];
  for (const ver of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(key)}`;
      const res = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
      const code = res.getResponseCode();
      const text = res.getContentText();
      console.log(`ListModels ${ver}: HTTP ${code}`);
      if (Math.floor(code/100) !== 2) {
        console.warn(`ListModels ${ver} non-2xx:`, text.slice(0, 500));
        continue;
      }
      const data = JSON.parse(text);
      const names = (data.models || []).map(m => m.name).slice(0, 200);
      console.log(`Available models (${ver}):\n` + names.join('\n'));
      SpreadsheetApp.getUi().alert('モデル一覧', `コンソールログに ${ver} のモデル一覧を出力しました。`, SpreadsheetApp.getUi().ButtonSet.OK);
      return;
    } catch (e) {
      console.warn(`ListModels ${ver} error:`, e && e.message ? e.message : e);
    }
  }
  SpreadsheetApp.getUi().alert('取得失敗', 'v1/v1beta のモデル一覧取得に失敗しました。ログをご確認ください。', SpreadsheetApp.getUi().ButtonSet.OK);
}

// ===== 要約テスト（手動UI） =====
function testCreateSummary_() {
  const ui = SpreadsheetApp.getUi();
  try {
    const cfg = loadSettings_();
    const subj = promptOrCancel_(ui, '要約テスト：件名', '例: 【ご案内】お打合せの件'); if (subj === null) return;
    const body = promptOrCancel_(ui, '要約テスト：本文', '本文を貼り付けてください（長文OK）'); if (body === null) return;

    const hasKey = !!(cfg && cfg.GEMINI_API_KEY && String(cfg.GEMINI_API_KEY).trim());
    const summary = createSummary_(subj, body, cfg);

    ui.alert(
      '要約結果（100文字以内）',
      (hasKey ? '【Gemini（v1→v1beta フォールバック対応）】\n' : '【簡易要約（API未使用）】\n') + (summary || '(空)'),
      ui.ButtonSet.OK
    );
  } catch (e) {
    console.error('testCreateSummary_ error:', e);
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

// ===== 要約テスト（コンソール） =====
function testCreateSummary() {
  const cfg = loadSettings_();
  const subj = '【ご案内】お打合せの件';
  const body = '本文を貼り付けてください（長文OK）\n複数行でもテスト可能です。';
  const summary = createSummary_(subj, body, cfg);
  console.log('要約結果：' + summary);
}

// ===== Discord送信 =====
function sendDiscord_(webhook, content) {
  const payload = { content, username: '執事AI Gmail Scanner' };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true };
  const res = UrlFetchApp.fetch(webhook, options);
  const code = res.getResponseCode();
  if (Math.floor(code/100) !== 2) {
    throw new Error(`Discord送信エラー: ${code} ${res.getContentText()}`);
  }
  return String(code); // 204 など
}

// ===== ラベル & メンション補助 =====
function getOrCreateLabel_(name) {
  let l = GmailApp.getUserLabelByName(name);
  if (!l) l = GmailApp.createLabel(name);
  return l;
}
function resolveMentionFromLabel_(labelName) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ラベル管理');
  if (!sh) return '';
  const v = sh.getDataRange().getValues();
  for (let i=1; i<v.length; i++) {
    const mention = (v[i][0] || '').toString().trim();   // A: MentionID
    const label = (v[i][1] || '').toString().trim();     // B: LabelName
    if (label && label === labelName && mention) return mention;
  }
  return '';
}

// ===== ユーティリティ =====
function formatFrom_(fromStr) {
  if (!fromStr) return '';
  const m = fromStr.match(/"?(.*?)"?\s*<(.+?)>/);
  if (m) return `${m[1]} (${m[2]})`.trim();
  return fromStr;
}
function sanitize_(s){ return String(s).replace(/\u0000/g,'').replace(/```/g,'ʼʼʼ'); }
function codeBlock_(s){ return '```\n' + (s || '') + '\n```'; }

// ===== テスト & トリガー =====
function testConfig() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('検索条件');
  if (!sh || sh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('設定不足', '検索条件シートに最低1行のルールを追加してください。', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  const r = 2; // 先頭ルールでテスト
  const query = (sh.getRange(r,1).getValue() || '').toString().trim();
  const webhook = (sh.getRange(r,2).getValue() || '').toString().trim();
  const mentionId = (sh.getRange(r,3).getValue() || '').toString().trim();
  const applyLabel = (sh.getRange(r,4).getValue() || '').toString().trim();

  if (!query || !/^https:\/\/discord\.com\/api\/webhooks\//.test(webhook)) {
    SpreadsheetApp.getUi().alert('設定不正', '先頭ルールのクエリ/Webhookを確認してください。', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const resolvedMention = mentionId || (applyLabel ? resolveMentionFromLabel_(applyLabel) : '');
  const msg =
`[執事AI]

${resolvedMention ? `<@${resolvedMention}> さま\n\n` : ''}設定テストです

（Gemini API 無料で要約）
${codeBlock_('このメッセージが見えればWebhook連携はOKです')}

---
件名：テスト
プレビュー：
${codeBlock_('テスト本文')}
`;
  sendDiscord_(webhook, msg);
  SpreadsheetApp.getUi().alert('テスト送信完了', 'Discordでメッセージを確認してください。', SpreadsheetApp.getUi().ButtonSet.OK);
}

function setupTriggerHourly() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'cronHourly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronHourly').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('トリガー設定', '1時間おきに実行します。', SpreadsheetApp.getUi().ButtonSet.OK);
}

function deleteTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let n=0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'cronHourly') { ScriptApp.deleteTrigger(t); n++; }
  });
  SpreadsheetApp.getUi().alert('トリガー削除', `${n}件のトリガーを削除しました。`, SpreadsheetApp.getUi().ButtonSet.OK);
}
