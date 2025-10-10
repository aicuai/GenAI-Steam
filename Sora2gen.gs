/**
 * Sora2gen.gs API 動画生成ツール for Google Sheets
 * https://github.com/aicuai/GenAI-Steam/blob/main/Sora2gen.gs
 * このスクリプトは、Googleスプレッドシートから直接OpenAI Sora2 APIを操作して、
 * 動画の生成と管理を行うためのものです。
 * claspなどのローカル開発環境での管理や、トリガーによる自動実行を想定しています。
 *
 * @version 3.0
 * @author aki@aicu.ai (AICU AIDX Lab)
 * Copyright (c) AICU AIDX Lab - All Rights Reserved
 */

// =================================================================
// ====                    グローバル定数                         ====
// =================================================================

const API_BASE_URL = "https://api.openai.com/v1/videos";
const PROMPT_GUIDE_SHEET_NAME = "プロンプトガイド";
const JOB_QUEUE_SHEET_NAME = "ジョブキュー";
const EXECUTION_LOG_SHEET_NAME = "実行ログ";

const UNPROCESSED_COLOR = '#ffffff'; // 白（またはnull）
const ERROR_COLOR = '#f4cccc'; // 薄い赤
const SUCCESS_COLOR = '#d9ead3'; // 薄い緑（ログ記録用）

// =================================================================
// ====                スプレッドシート取得コア                   ====
// =================================================================

/**
 * 操作対象のスプレッドシートオブジェクトを取得します。
 * @returns {Spreadsheet} 操作対象のスプレッドシートオブジェクト。
 */
function getSpreadsheet() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('SPREADSHEET_ID');

  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      Logger.log(`ID(${spreadsheetId})によるスプレッドシートのオープンに失敗しました: ${e.message}`);
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    properties.setProperty('SPREADSHEET_ID', ss.getId());
    return ss;
  }
  
  throw new Error("スクリプトが操作するスプレッドシートを特定できません。一度、スプレッドシートの画面からメニューの「🎬 Sora2 動画生成ツール > 📄 シートを初期化」を実行して、IDをスクリプトに記録させてください。");
}


// =================================================================
// ====                メニュー & シート初期設定                  ====
// =================================================================

/**
 * スプレッドシートを開いた時にカスタムメニューを作成します。
 * 設定が完了していない場合は、設定を促すメニューを表示します。
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    const settings = getSettings();
    const menu = ui.createMenu('🎬 Sora2 動画生成ツール');

    if (settings.OPENAI_API_KEY && settings.DriveOutputDirID) {
      // 設定完了時のメニュー
      menu.addItem(`▶️ ジョブキューを一括実行`, 'processJobQueue');
      menu.addItem(`🔄 実行ログを更新`, 'checkAllPendingJobsInLog');
      menu.addSeparator();
      menu.addItem('🕒 更新チェックを毎分実行', 'createTimeBasedTrigger');
      menu.addItem('🔕 更新チェックを解除', 'deleteTimeBasedTrigger');
      menu.addSeparator();
      menu.addItem(`📄 APIから動画リストを取得`, 'listAllVideosAndLog');
      menu.addItem(`🗑️ 選択行の動画を削除 (「${EXECUTION_LOG_SHEET_NAME}」シート)`, 'deleteVideoFromLogRow');
      menu.addSeparator();
      menu.addItem('⚙️ 設定を変更', 'showSettingsDialog');
      menu.addItem('🔍 現在の設定を確認', 'showCurrentSettings');
      menu.addItem('📄 シートを初期化', 'initializeSheetsMenu');
      menu.addItem('🗑️ 全ての設定を削除して初期化', 'clearAllSettings');
    } else {
      // 設定未完了時のメニュー
      menu.addItem('最初に設定を行ってください', 'showSettingsDialog');
      menu.addSeparator();
      menu.addItem('⚙️ 設定 & APIテスト', 'showSettingsDialog');
      menu.addItem('📄 シートを初期化', 'initializeSheetsMenu');
      menu.addItem('🗑️ 全ての設定を削除して初期化', 'clearAllSettings');
    }
    menu.addToUi();

  } catch (e) {
    Logger.log('メニューの作成に失敗しました: ' + e.message);
  }
  setupSheets();
}

/**
 * メニューから手動でシートを初期化し、スプレッドシートIDをスクリプトプロパティに保存します。
 */
function initializeSheetsMenu() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    SpreadsheetApp.getUi().alert("スプレッドシートがアクティブでないため、初期化できませんでした。");
    return;
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  
  setupSheets();
  
  Logger.log(`必要なシートを確認・作成し、このスプレッドシートのIDをスクリプトに記録しました。`);
  SpreadsheetApp.getUi().toast('シートを初期化し、IDを記録しました。');
}

function setupSheets() {
  try {
    const ss = getSpreadsheet();
    const sheets = ss.getSheets().map(s => s.getName());
    
    // プロンプトガイドシート
    if (!sheets.includes(PROMPT_GUIDE_SHEET_NAME)) {
      const sheet = ss.insertSheet(PROMPT_GUIDE_SHEET_NAME, 0);
      const guideData = [
        ['カテゴリ / テクニック', 'プロンプト例 / 解説'],
        ['【基本】プロンプトの構成', '「[ショットの種類] of a [被写体] [アクション] in [設定], [照明], camera [カメラの動き].」のように、要素を具体的に記述します。'],
        ['【高品質化のコツ】動画形式の指定', '「イメージビデオ」「CM」「ミュージックビデオ(MV)」「予告編」「ゲーム実況」「THE FIRST TAKE」などのキーワードを入れると、AIが構成やカット割りを解釈しやすくなります。'],
        ['【画像からの動画生成】', '「リクエスト種別」を`image2video`にし、「入力画像のURL」列に公開画像URLを貼り付けます。プロンプトには「この女性が振り返って微笑む」のように、画像内の被写体にさせたい「アクション」を記述します。'],
        ['【リミックス】', '「リクエスト種別」を`remix`にし、「リミックス元の動画ID」列に過去に生成した動画IDを入れます。プロンプトには「モンスターの色をオレンジ色に変更する」のように、「変更点」を具体的に記述します。'],
        ['----- 作風別サンプル -----', '----- ↓↓↓ これらのプロンプトをコピーして「ジョブキュー」シートでお試しください ↓↓↓ -----'],
        ['作風: アニメ (シンプル)', '花畑で踊るアニメ少女'],
        ['作風: アニメMV (疾走感)', 'POV, anime MV, いつかきっと会える（日本語テロップ）, 金髪ポニーテールの少女, 黒いオフショルダーのゴシックドレス, 雨のネオン街, 激しいピアノリフ, 180bpm相当の疾走感, ビート同期の高速シーン切替, 透き通った歌声とエモーショナルな高音, シネマティック, 被写界深度, ライトブルーム'],
        ['作風: 実写風 (街歩き配信)', '日本人の女性ユーチューバーが浅草の街を食べ歩きしながら配信している。'],
        ['作風: 実写風 (インタビュー)', 'インタビュー動画 新橋の駅前で酔ったサラリーマンにAIについて聞いてみました'],
        ['作風: イメージビデオ (アイドル)', '人気アイドルのイメージビデオ'],
        ['作風: CM (ビール)', '日本人の美女が出てくるビールのコマーシャル'],
        ['作風: CM (Webサービス)', '最新転職マッチングサイトのPR動画'],
        ['作風: MV (Vtuber)', '最新のVtuberのアニメストーリー風MV'],
        ['作風: MV (THE FIRST TAKE)', '日本の女性シンガーの「THE FIRST TAKE」動画'],
        ['作風: エフェクト動画', '黒背景に白い図形のエフェクト動画。BGMと効果音あり。'],
        ['作風: キネティック・タイポグラフィ', 'キネティック・タイポグラフィを使用した洗練されたデザインのMV'],
        ['作風: YouTube (ゲーム実況)', '人気Vtuberのゲーム実況'],
        ['作風: 映画OP (ホラー)', '「クトゥルフの花嫁」というタイトルの映画のオープニングムービー'],
        ['作風: ゲームOP (ファンタジーRPG)', '新作ファンタジーRPGのオープニングムービー'],
        ['作風: 緊急速報ニュース', '緊急特報ニュース風の動画。宇宙人が襲来し、アナウンサーが伝える中、スタジオにも宇宙人が現れる。'],
        ['(参考) Cameo機能について', '公式アプリのCameo機能（例: @sama）はAPIでは直接利用できません。代わりに「サム・アルトマンによく似た男性がラーメン屋に現れる」のように、人物の特徴をプロンプトで具体的に記述する必要があります。']
      ];
      sheet.getRange(1, 1, guideData.length, 2).setValues(guideData);
      sheet.getRange('A1:B1').setFontWeight('bold');
      sheet.getRange('A6:B6').setFontWeight('bold');
      sheet.setColumnWidth(1, 250).setColumnWidth(2, 650);
    }
    
    const requestValidation = SpreadsheetApp.newDataValidation().requireValueInList(['text2video', 'image2video', 'remix']).build();
    const modelValidation = SpreadsheetApp.newDataValidation().requireValueInList(['sora-2', 'sora-2-pro']).build();
    const sizeValidation = SpreadsheetApp.newDataValidation().requireValueInList(['1280x720', '720x1280', '1792x1024', '1024x1792']).build();
    const secondsValidation = SpreadsheetApp.newDataValidation().requireValueInList([4, 8, 12]).build();

    // ジョブキューシート
    if (!sheets.includes(JOB_QUEUE_SHEET_NAME)) {
      const sheet = ss.insertSheet(JOB_QUEUE_SHEET_NAME, 1);
      const headers = ['リクエスト種別', 'プロンプト', '入力画像のURL', 'リミックス元の動画ID', 'モデル', 'サイズ', '動画の長さ(秒)', '最終エラー'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.getRange('A2:H2').setValues([
          ['text2video', '満開の桜並木の下を歩く、元気な柴犬', '', '', 'sora-2', '1280x720', 8, '']
      ]);
      sheet.getRange('A2:A').setDataValidation(requestValidation);
      sheet.getRange('E2:E').setDataValidation(modelValidation);
      sheet.getRange('F2:F').setDataValidation(sizeValidation);
      sheet.getRange('G2:G').setDataValidation(secondsValidation);
      sheet.setColumnWidth(8, 300);
    }

    // 実行ログシート
    if (!sheets.includes(EXECUTION_LOG_SHEET_NAME)) {
      const sheet = ss.insertSheet(EXECUTION_LOG_SHEET_NAME, 2);
      const headers = [
        '実行日時', 'リクエスト種別', 'プロンプト', '入力画像のURL', 'リミックス元の動画ID', 'モデル',
        'サイズ', '動画の長さ(秒)', 'ジョブID', 'ステータス', '進捗(%)', 'エラーメッセージ',
        '動画URL', 'サムネイルURL', 'スプライトシートURL'
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    }

  } catch (e) {
    Logger.log("シートのセットアップ中にエラーが発生しました: " + e.message);
  }
}

// =================================================================
// ====                    メイン処理ロジック                     ====
// =================================================================

/**
 * 現在保存されている設定をポップアップで表示します。
 */
function showCurrentSettings() {
  const ui = SpreadsheetApp.getUi();
  const settings = getSettings();
  const maskedApiKey = settings.OPENAI_API_KEY 
    ? `${settings.OPENAI_API_KEY.substring(0, 5)}...${settings.OPENAI_API_KEY.substring(settings.OPENAI_API_KEY.length - 4)}`
    : '未設定';
  
  const driveId = settings.DriveOutputDirID || '未設定';
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '未記録';

  let message = `現在の設定内容は以下の通りです。\n\n`;
  message += `APIキー: ${maskedApiKey}\n`;
  message += `DriveフォルダID: ${driveId}\n`;
  message += `スプレッドシートID: ${spreadsheetId}`;

  ui.alert('現在の設定確認', message, ui.ButtonSet.OK);
}

/**
 * 設定を入力・保存するためのダイアログを表示し、API接続テストを実行します。
 */
function showSettingsDialog() {
  const ui = SpreadsheetApp.getUi();
  const properties = PropertiesService.getScriptProperties();
  const currentSettings = properties.getProperties();
  
  const apiKeyResponse = ui.prompt(
    '設定 (1/2): APIキー',
    `OpenAI APIキーを入力してください。\n（現在の設定: ${currentSettings.OPENAI_API_KEY || '未設定'}）`,
    ui.ButtonSet.OK_CANCEL
  );

  if (apiKeyResponse.getSelectedButton() !== ui.Button.OK) return;
  const apiKey = apiKeyResponse.getResponseText();

  const driveIdResponse = ui.prompt(
    '設定 (2/2): Googleドライブ フォルダID',
    `生成した動画を保存するGoogleドライブのフォルダIDを入力してください。\n（現在の設定: ${currentSettings.DriveOutputDirID || '未設定'}）`,
    ui.ButtonSet.OK_CANCEL
  );

  if (driveIdResponse.getSelectedButton() !== ui.Button.OK) return;
  const driveId = driveIdResponse.getResponseText();

  try {
    properties.setProperties({
      'OPENAI_API_KEY': apiKey,
      'DriveOutputDirID': driveId
    });

    const savedSettings = getSettings();
    const maskedApiKey = savedSettings.OPENAI_API_KEY 
      ? `${savedSettings.OPENAI_API_KEY.substring(0, 5)}...${savedSettings.OPENAI_API_KEY.substring(savedSettings.OPENAI_API_KEY.length - 4)}`
      : '保存に失敗しました';

    Logger.log(`設定を保存しました: APIキー=${maskedApiKey}, DriveID=${savedSettings.DriveOutputDirID}`);
    ui.alert(`以下の内容で設定を保存しました。\n\nAPIキー: ${maskedApiKey}\nDriveフォルダID: ${savedSettings.DriveOutputDirID}\n\n次にAPI接続テストを実行します。\nテスト完了後、メニューを更新するためにスプレッドシートを再読み込みしてください。`);
    
    testApiConnection();

  } catch (e) {
    const errorMessage = '設定の保存中にエラーが発生しました:\n' + e.message;
    ui.alert(errorMessage);
    Logger.log(errorMessage);
  }
}


/**
 * APIキーの有効性をテストし、結果をポップアップで表示します。
 */
function testApiConnection() {
  const ui = SpreadsheetApp.getUi();
  try {
    const settings = getSettings();
    if (!settings.OPENAI_API_KEY) {
      throw new Error('APIキーが設定されていません。');
    }
    
    callSoraApi('', { method: 'get' }); // 安価なリスト取得APIでテスト
    
    const successMessage = `API接続テストに成功しました。\n(${new Date().toLocaleString('ja-JP')})`;
    ui.alert(successMessage);
    Logger.log(successMessage);

  } catch (e) {
    const errorMessage = 'API接続テストに失敗しました:\n' + e.message;
    ui.alert(errorMessage);
    Logger.log(errorMessage);
  }
}

function processJobQueue() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(JOB_QUEUE_SHEET_NAME);
  if (!sheet) return;

  const range = sheet.getDataRange();
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const headers = values[0].map(h => h.trim());
  const errorColIndex = headers.indexOf('最終エラー');
  let processedCount = 0;
  
  // ★★ 事前チェック：設定が有効か確認 ★★
  const settings = getSettings();
  try {
    if (!settings.DriveOutputDirID) throw new Error('DriveフォルダIDが未設定です。');
    DriveApp.getFolderById(settings.DriveOutputDirID); // ここでIDの有効性をチェック
  } catch (e) {
    Logger.log(`DriveフォルダIDが無効なため、ジョブキューの処理を中止しました: ${e.message}`);
    const activeSS = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSS) {
      activeSS.toast('エラー: DriveフォルダIDが無効です。「設定を変更」から正しいIDを設定してください。', '設定エラー', 30);
    }
    return; // 設定が不正な場合はここで処理を中断
  }


  for (let i = values.length - 1; i >= 1; i--) {
    const rowNum = i + 1;
    const bgColor = backgrounds[i][0];

    if (bgColor === UNPROCESSED_COLOR || bgColor === null || bgColor === '') {
      processedCount++;
      const rowRange = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn());
      const jobData = getDataFromRow(rowRange);

      if(errorColIndex !== -1) {
        sheet.getRange(rowNum, errorColIndex + 1).clearContent();
      }

      try {
        if (!jobData['プロンプト']) {
          throw new Error('プロンプトが入力されていません。B列を記入してください。');
        }

        const paramMap = { 'プロンプト': 'prompt', 'モデル': 'model', 'サイズ': 'size', '動画の長さ(秒)': 'seconds' };
        const params = {};
        for (const key in paramMap) {
          if (jobData[key]) params[paramMap[key]] = jobData[key];
        }

        let response;
        if (jobData['リクエスト種別'] === 'image2video' && jobData['入力画像のURL']) {
          params.input_reference = urlToBlob(jobData['入力画像のURL']);
          response = createVideoJob(params);
        } else if (jobData['リクエスト種別'] === 'remix' && jobData['リミックス元の動画ID']) {
          response = remixVideoJob(jobData['リミックス元の動画ID'], { prompt: params.prompt });
        } else {
          response = createVideoJob(params);
        }
        
        jobData['実行日時'] = new Date();
        jobData['ジョブID'] = response.id;
        jobData['ステータス'] = response.status;
        jobData['進捗(%)'] = response.progress || 0;
        
        appendToLog(jobData);
        sheet.deleteRow(rowNum);

      } catch (e) {
        Logger.log(`Error on row ${rowNum}: ${e.message}`);
        if (errorColIndex !== -1) {
          sheet.getRange(rowNum, errorColIndex + 1).setValue(e.message);
        }
        sheet.getRange(rowNum, 1).setBackground(ERROR_COLOR);
      }
    }
  }
  Logger.log(`${processedCount}件のジョブを処理しました。`);
  const activeSS = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSS) {
    if (processedCount > 0) {
      activeSS.toast(`${processedCount}件のジョブをキューに追加しました。`, '▶️ 実行開始');
    } else {
      activeSS.toast('実行対象のジョブがありませんでした。', '▶️ 実行完了');
    }
  }
}

function checkAllPendingJobsInLog() {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(EXECUTION_LOG_SHEET_NAME);
    const dataRange = sheet.getDataRange();
    if (dataRange.getNumRows() <= 1) return;
    
    const data = dataRange.getValues();
    const headers = data.shift();
    const statusColIndex = headers.indexOf('ステータス');
    const jobIdColIndex = headers.indexOf('ジョブID');
    let updatedCount = 0;

    data.forEach((row, index) => {
        const status = row[statusColIndex];
        const jobId = row[jobIdColIndex];
        if (jobId && (status === 'queued' || status === 'in_progress')) {
            checkJobStatus(index + 2, jobId);
            updatedCount++;
        }
    });
    Logger.log(`${updatedCount}件のジョブステータスを更新しました。`);
    const activeSS = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSS) {
      if (updatedCount > 0) {
        activeSS.toast(`${updatedCount}件のジョブステータスを更新しました。`, '🔄 更新完了');
      } else {
        activeSS.toast('更新対象の待機中ジョブはありませんでした。', '🔄 確認完了');
      }
    }
}

function checkJobStatus(rowNum, videoId) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(EXECUTION_LOG_SHEET_NAME);
    const range = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn());
    const jobData = getDataFromRow(range);

    const response = callSoraApi(`/${videoId}`, { method: 'get' });
    
    jobData['ステータス'] = response.status;
    jobData['進捗(%)'] = response.progress || 0;
    jobData['エラーメッセージ'] = response.error ? response.error.message : '';

    if (response.status === 'completed') {
      // ★★ ダウンロード直前にも設定をチェック ★★
      const settings = getSettings();
      try {
        if (!settings.DriveOutputDirID) throw new Error('DriveフォルダIDが未設定です。');
        const folder = DriveApp.getFolderById(settings.DriveOutputDirID);

        const videoBlob = callSoraApi(`/${videoId}/content?variant=video`, { method: 'get' });
        jobData['動画URL'] = folder.createFile(videoBlob.setName(`${videoId}.mp4`)).getUrl();

        const thumbBlob = callSoraApi(`/${videoId}/content?variant=thumbnail`, { method: 'get' });
        jobData['サムネイルURL'] = folder.createFile(thumbBlob.setName(`${videoId}_thumb.webp`)).getUrl();
        
        const spriteBlob = callSoraApi(`/${videoId}/content?variant=spritesheet`, { method: 'get' });
        jobData['スプライトシートURL'] = folder.createFile(spriteBlob.setName(`${videoId}_sprite.jpg`)).getUrl();
        
        range.setBackground(SUCCESS_COLOR);
      } catch (driveError) {
        // Drive関連のエラーをキャッチしてログに記録
        throw new Error(`動画の保存に失敗しました: ${driveError.message} (DriveフォルダIDが無効か、アクセス権限がない可能性があります)`);
      }
    } else if (response.status === 'failed') {
      range.setBackground(ERROR_COLOR);
    }
    
    updateLogRow(rowNum, jobData);

  } catch (e) {
    Logger.log(`行 ${rowNum} の更新中にエラー: ${e.message}`);
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(EXECUTION_LOG_SHEET_NAME);
    sheet.getRange(rowNum, 1).setBackground(ERROR_COLOR);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const errorMsgCol = headers.indexOf('エラーメッセージ') + 1;
    if(errorMsgCol > 0) {
      sheet.getRange(rowNum, errorMsgCol).setValue(e.message);
    }
  }
}

function listAllVideosAndLog() {
    try {
        const ss = getSpreadsheet();
        const response = callSoraApi('', { method: 'get' });
        const sheet = ss.getSheetByName(EXECUTION_LOG_SHEET_NAME);
        const videoData = response.data.map(video => [ new Date(video.created_at * 1000), '', '', '', '', video.model, video.size, video.seconds, video.id, video.status, video.progress || 0, video.error ? video.error.message : '' ]);
        if (videoData.length > 0) {
            sheet.getRange(sheet.getLastRow() + 1, 1, videoData.length, videoData[0].length).setValues(videoData);
            Logger.log(`APIから ${videoData.length} 件の動画情報を取得し、ログに記録しました。`);
        } else {
            Logger.log('ご自身のアカウントには動画が見つかりませんでした。');
        }
    } catch (e) {
        Logger.log('動画リストの取得に失敗しました: ' + e.message);
    }
}

function deleteVideoFromLogRow() {
  const ss = getSpreadsheet();
  const range = ss.getActiveRange();
  if (!range || range.getSheet().getName() !== EXECUTION_LOG_SHEET_NAME || range.getRow() === 1 || range.getNumRows() > 1) {
    Logger.log(`削除処理がスキップされました。削除したい行を「${EXECUTION_LOG_SHEET_NAME}」シートで1行だけ選択してください。`);
    return;
  }
  
  const jobData = getDataFromRow(range);
  const videoId = jobData['ジョブID'];
  if (!videoId) { 
    Logger.log('選択された行にはジョブIDがありません。');
    return;
  }

  try {
      const response = callSoraApi(`/${videoId}`, { method: 'delete' });
      if (response.deleted) {
          jobData['ステータス'] = 'deleted';
          ['進捗(%)', 'エラーメッセージ', '動画URL', 'サムネイルURL', 'スプライトシートURL'].forEach(key => jobData[key] = '');
          updateLogRow(jobData.row, jobData);
          Logger.log(`動画 ${videoId} を削除しました。`);
      }
  } catch (e) {
      Logger.log('動画の削除に失敗しました: ' + e.message);
  }
}

// =================================================================
// ====                    トリガー管理                          ====
// =================================================================

/**
 * 'checkAllPendingJobsInLog'関数を1分ごとに実行するトリガーを作成します。
 * 既存のトリガーは削除してから新しく作成します。
 */
function createTimeBasedTrigger() {
  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'checkAllPendingJobsInLog') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // 新しいトリガーを作成
  ScriptApp.newTrigger('checkAllPendingJobsInLog')
      .timeBased()
      .everyMinutes(1)
      .create();
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    ss.toast('ログの自動更新が開始されました（毎分）。', '🕒 スケジュール設定完了', 10);
  }
  Logger.log('ログの自動更新を毎分実行するようスケジュールしました。');
}

/**
 * 'checkAllPendingJobsInLog'関数に関連するすべてのトリガーを削除します。
 */
function deleteTimeBasedTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = false;
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'checkAllPendingJobsInLog') {
      ScriptApp.deleteTrigger(trigger);
      deleted = true;
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) {
    if (deleted) {
      ss.toast('ログの自動更新を停止しました。', '🔕 スケジュール解除完了', 10);
    } else {
      ss.toast('設定されている自動更新スケジュールはありませんでした。', '🔕 情報', 10);
    }
  }
  Logger.log('ログの自動更新スケジュールを解除しました。');
}

/**
 * 全ての設定（ScriptProperties）とシートを削除し、完全に初期状態に戻します。
 */
function clearAllSettings() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.confirm(
    '本当に実行しますか？',
    '保存されているAPIキーやフォルダIDの設​​定がすべて削除され、シートも初期化されます。この操作は元に戻せません。',
    ui.ButtonSet.YES_NO
  );

  if (response === ui.Button.YES) {
    try {
      // Delete Script Properties
      PropertiesService.getScriptProperties().deleteAllProperties();
      Logger.log('全てのスクリプトプロパティを削除しました。');

      // Delete Sheets
      const ss = getSpreadsheet();
      const sheetsToDelete = [PROMPT_GUIDE_SHEET_NAME, JOB_QUEUE_SHEET_NAME, EXECUTION_LOG_SHEET_NAME];
      ss.getSheets().forEach(sheet => {
        if (sheetsToDelete.includes(sheet.getName())) {
          ss.deleteSheet(sheet);
        }
      });
      Logger.log('関連シートを削除しました。');
      
      SpreadsheetApp.flush(); // Ensure deletions are committed before recreating

      // Re-initialize sheets
      setupSheets();
      Logger.log('シートを再初期化しました。');

      ui.alert('全ての設定とシートがリセットされました。ページを再読み込みしてメニューを更新してください。');

    } catch (e) {
      Logger.log('設定の全削除中にエラーが発生しました: ' + e.message);
      ui.alert('リセット処理中にエラーが発生しました。\n' + e.message);
    }
  }
}

// =================================================================
// ====                      補助関数群                          ====
// =================================================================

function callSoraApi(endpoint, options) {
  const settings = getSettings();
  const apiKey = settings.OPENAI_API_KEY;
  if (!apiKey) throw new Error('APIキーが設定されていません。');
  options.headers = { ...options.headers, 'Authorization': 'Bearer ' + apiKey };
  options.muteHttpExceptions = true;
  const response = UrlFetchApp.fetch(API_BASE_URL + endpoint, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  if (responseCode >= 400) {
    Logger.log(`APIエラー: ${responseCode} - ${responseBody}`);
    let errorMessage = `APIでエラーが発生しました (${responseCode})。`;
    try {
      const errorObj = JSON.parse(responseBody);
      if (errorObj.error && errorObj.error.message) errorMessage = `APIエラー: ${errorObj.error.message} (${responseCode})`;
    } catch (e) {
      errorMessage = `APIエラー: ${responseBody} (${responseCode})`;
    }
    throw new Error(errorMessage);
  }
  const contentType = response.getHeaders()['Content-Type'];
  return (contentType && !contentType.includes('application/json')) ? response.getBlob() : JSON.parse(responseBody);
}

function getDataFromRow(range) {
    const sheet = range.getSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.trim());
    const values = range.getValues()[0];
    const data = {};
    headers.forEach((header, i) => { if (header) data[header] = values[i]; });
    data.row = range.getRow();
    return data;
}

function appendToLog(data) {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(EXECUTION_LOG_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = headers.map(header => data[header.trim()] !== undefined ? data[header.trim()] : '');
    sheet.appendRow(values);
}

function updateLogRow(rowNum, data) {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(EXECUTION_LOG_SHEET_NAME);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = headers.map(header => data[header.trim()] !== undefined ? data[header.trim()] : '');
    sheet.getRange(rowNum, 1, 1, values.length).setValues([values]);
}

function createVideoJob(params) {
  const boundary = "----" + Utilities.getUuid();
  let data = "";
  ['prompt', 'model', 'size', 'seconds'].forEach(field => {
    if (params[field]) data += `--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${params[field]}\r\n`;
  });
  let payload;
  if (params.input_reference) {
    const fileBlob = params.input_reference;
    data += `--${boundary}\r\nContent-Disposition: form-data; name="input_reference"; filename="${fileBlob.getName()}"\r\nContent-Type: ${fileBlob.getContentType()}\r\n\r\n`;
    payload = Utilities.newBlob(data).getBytes().concat(fileBlob.getBytes()).concat(Utilities.newBlob(`\r\n--${boundary}--`).getBytes());
  } else {
    data += `--${boundary}--`;
    payload = Utilities.newBlob(data).getBytes();
  }
  return callSoraApi('', { method: 'post', contentType: `multipart/form-data; boundary=${boundary}`, payload: payload });
}

function remixVideoJob(videoId, params) {
  return callSoraApi(`/${videoId}/remix`, { method: 'post', contentType: 'application/json', payload: JSON.stringify(params) });
}

/**
 * ScriptPropertiesから設定値を取得します。
 * @returns {object} 設定オブジェクト
 */
function getSettings() {
  return PropertiesService.getScriptProperties().getProperties();
}

function urlToBlob(url) {
    return UrlFetchApp.fetch(url).getBlob();
}

