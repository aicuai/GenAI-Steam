/**
 * Meet Rec Manager
 * MeetRecSearchAndMove.gs
 * Coded by Akihiko Shirai
 * https://github.com/aicuai/GenAI-Steam/blob/main/MeetRecSearchAndMove.gs
 * Gmailに届いたGoogle Meetの録画ファイルを自動で指定フォルダに移動するスクリプトです。
 * また、Geminiが自動生成する会議メモ（Google Docs）も同じフォルダに移動し、
 * 誤変換単語の自動置換を行います。
 * 
 * 処理の頻度は1時間に1回ぐらいでいいと思います。
 * メールの削除等は、通知メールに対しては削除します。成功したメールは既読になり、
 * 次回から処理対象にはなりません。もちろん何が起きても保証はできません！
 * 
 * ■ Script Properties:
 *   SLACK_WEBHOOK   - Slack Incoming Webhook URL（システム全体通知）
 *   DISCORD_WEBHOOK - Discord Webhook URL（システム全体通知）
 * 
 * ■ シート構成:
 *   SearchAndMove - 会議ごとの設定（録画移動 + メモ処理）
 *   MoveLog       - 処理ログ
 *   ReplaceDict   - 単語置換辞書（Geminiメモ用）
 */

// ============================================================
// メニュー・初期設定
// ============================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('録画管理')
    .addItem('権限設定', 'getOAuthToken')
    .addItem('設定シート作成', 'createSetupSheets')
    .addItem('毎時起動設定', 'setHourlyTrigger')
    .addItem('即時処理（録画）', 'SearchAndMove')
    .addItem('即時処理（メモ）', 'SearchAndMoveMemo')
    .addToUi();
}

/**
 * 必要なシートを新規作成し、ヘッダ行を設定する
 * - SearchAndMove: 会議ごとの設定
 * - MoveLog: 処理ログ
 * - ReplaceDict: 単語置換辞書
 */
function createSetupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // SearchAndMoveシートの作成
  let searchAndMoveSheet = ss.getSheetByName('SearchAndMove');
  if (!searchAndMoveSheet) {
    searchAndMoveSheet = ss.insertSheet('SearchAndMove');
    const headers = ['MeetingName', 'RenameTo', 'Serial', 'MoveToDriveURL', 'EmailTo', 'Slack/Discord', 'Memo', 'Check'];
    searchAndMoveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    searchAndMoveSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    searchAndMoveSheet.setFrozenRows(1);
  } else {
    // 既存シートのマイグレーション（バッチ処理でタイムアウト防止）
    const existingHeaders = searchAndMoveSheet.getRange(1, 1, 1, searchAndMoveSheet.getLastColumn()).getValues()[0];

    // SlackTo → Slack/Discord
    const slackToIndex = existingHeaders.indexOf('SlackTo');
    const discordToIndex = existingHeaders.indexOf('DiscordTo');
    if (slackToIndex !== -1) {
      searchAndMoveSheet.getRange(1, slackToIndex + 1).setValue('Slack/Discord');
    }
    if (discordToIndex !== -1) {
      const lastRow = searchAndMoveSheet.getLastRow();
      if (lastRow > 1 && slackToIndex !== -1) {
        // バッチ読み取り
        const slackVals = searchAndMoveSheet.getRange(2, slackToIndex + 1, lastRow - 1, 1).getValues();
        const discordVals = searchAndMoveSheet.getRange(2, discordToIndex + 1, lastRow - 1, 1).getValues();
        for (let r = 0; r < slackVals.length; r++) {
          if (discordVals[r][0]) {
            slackVals[r][0] = slackVals[r][0] ? slackVals[r][0] + '\n' + discordVals[r][0] : discordVals[r][0];
          }
        }
        // バッチ書き込み
        searchAndMoveSheet.getRange(2, slackToIndex + 1, slackVals.length, 1).setValues(slackVals);
      }
      searchAndMoveSheet.deleteColumn(discordToIndex + 1);
    }

    // Memo列がなければCheck列の前に追加
    const refreshedHeaders = searchAndMoveSheet.getRange(1, 1, 1, searchAndMoveSheet.getLastColumn()).getValues()[0];
    if (refreshedHeaders.indexOf('Memo') === -1) {
      const checkIdx = refreshedHeaders.indexOf('Check');
      if (checkIdx !== -1) {
        searchAndMoveSheet.insertColumnBefore(checkIdx + 1);
        searchAndMoveSheet.getRange(1, checkIdx + 1).setValue('Memo').setFontWeight('bold');
      } else {
        const newCol = searchAndMoveSheet.getLastColumn() + 1;
        searchAndMoveSheet.getRange(1, newCol).setValue('Memo').setFontWeight('bold');
      }
    }
  }

  // MoveLogシートの作成
  let moveLogSheet = ss.getSheetByName('MoveLog');
  if (!moveLogSheet) {
    moveLogSheet = ss.insertSheet('MoveLog');
    const moveLogHeaders = ['ProceedTime', 'MeetingName', 'NewName', 'MovedTo', 'RecFile', 'Result'];
    moveLogSheet.getRange(1, 1, 1, moveLogHeaders.length).setValues([moveLogHeaders]);
    moveLogSheet.getRange(1, 1, 1, moveLogHeaders.length).setFontWeight('bold');
    moveLogSheet.setFrozenRows(1);
  }

  // ReplaceDictシートの作成
  let replaceDictSheet = ss.getSheetByName('ReplaceDict');
  if (!replaceDictSheet) {
    replaceDictSheet = ss.insertSheet('ReplaceDict');
    const replaceDictHeaders = ['Before', 'After', 'Count'];
    replaceDictSheet.getRange(1, 1, 1, replaceDictHeaders.length).setValues([replaceDictHeaders]);
    replaceDictSheet.getRange(1, 1, 1, replaceDictHeaders.length).setFontWeight('bold');
    replaceDictSheet.setFrozenRows(1);
    // サンプルデータ
    replaceDictSheet.getRange(2, 1, 1, 3).setValues([['AIQ', 'AICU', 0]]);
  } else {
    // 既存ReplaceDictにCount列がなければ追加
    const dictHeaders = replaceDictSheet.getRange(1, 1, 1, replaceDictSheet.getLastColumn()).getValues()[0];
    if (dictHeaders.indexOf('Count') === -1) {
      const newCol = replaceDictSheet.getLastColumn() + 1;
      replaceDictSheet.getRange(1, newCol).setValue('Count').setFontWeight('bold');
      // 既存行のCount列を0で初期化
      const lastRow = replaceDictSheet.getLastRow();
      if (lastRow > 1) {
        const zeros = Array(lastRow - 1).fill([0]);
        replaceDictSheet.getRange(2, newCol, lastRow - 1, 1).setValues(zeros);
      }
    }
  }

  ui.alert('設定シートの作成が完了しました。\n\n' +
    '■ Memo列（Geminiメモ処理）:\n' +
    '  Move = フォルダに移動のみ\n' +
    '  Replace = 単語置換（ReplaceDict）してから移動\n' +
    '  空欄 = メモは処理しない\n\n' +
    '※ 通知はSlack/Discord列・EmailTo列の設定に従い自動送信されます。');
}

function setHourlyTrigger() {
  const ui = SpreadsheetApp.getUi();
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledRun') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('scheduledRun')
    .timeBased()
    .everyHours(1)
    .create();
  ui.alert('毎時起動の設定が完了しました。');
}

function runSearchAndMoveNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    SearchAndMove();
    ui.alert('処理が完了しました。');
  } catch (error) {
    ui.alert('エラーが発生しました: ' + error.toString());
  }
}

// 必要なスコープを明示的に要求（DocumentAppを追加）
function getOAuthToken() {
  DriveApp.getRootFolder();
  GmailApp.getInboxUnreadCount();
  SpreadsheetApp.getActiveSpreadsheet();
  DocumentApp.create('_scope_check_').setTrashed(true); // DocumentApp scope取得用
}

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * セルの値からコピペ時のゴミ文字を除去する
 */
function cleanCellValue(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/^[_*`'"]+|[_*`'"]+$/g, '').trim();
  } while (s !== prev);
  return s;
}

function detectWebhookType(url) {
  if (!url) return 'unknown';
  url = url.trim();
  if (url.includes('hooks.slack.com')) return 'slack';
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) return 'discord';
  return 'unknown';
}

function parseWebhookUrls(cellValue) {
  if (!cellValue) return [];
  return String(cellValue)
    .split(/[\n,;]+/)
    .map(url => cleanCellValue(url))
    .filter(url => url.length > 0);
}

/**
 * URLからGoogle DriveのファイルIDまたはフォルダIDを抽出する
 */
function getDriveIdFromUrl(url) {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    console.log("getDriveIdFromUrl: URL is empty or undefined");
    return null;
  }
  console.log("Extracting Drive ID from URL: " + url);
  
  let match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) { console.log("Extracted folder ID: " + match[1]); return match[1]; }

  if (url.includes('open?id=')) {
    const id = url.split('open?id=')[1].split('&')[0];
    console.log("Extracted file ID from open?id=: " + id);
    return id;
  }

  match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) { console.log("Extracted file ID from /d/: " + match[1]); return match[1]; }

  console.log("Failed to extract Drive ID from URL");
  return null;
}

/**
 * メール本文からGoogle DriveのファイルURLを抽出する
 */
function extractFileURLs(body) {
  const regex = /href="(https:\/\/drive\.google\.com\/(?:open\?id=|file\/d\/)[a-zA-Z0-9-_]+(?:\/view)?[^"]*)"/g;
  const matches = body.matchAll(regex);
  const urls = [];
  for (const match of matches) { urls.push(match[1]); }
  console.log("Extracted file URLs: " + urls.join(", "));
  return urls;
}

/**
 * メール本文からGoogle DocsのURLを抽出する
 */
function extractDocsURLs(body) {
  const regex = /href="(https:\/\/docs\.google\.com\/document\/d\/[a-zA-Z0-9-_]+[^"]*)"/g;
  const matches = body.matchAll(regex);
  const urls = [];
  const seen = new Set();
  for (const match of matches) {
    const docId = getDriveIdFromUrl(match[1]);
    if (docId && !seen.has(docId)) {
      seen.add(docId);
      urls.push(match[1]);
    }
  }
  console.log("Extracted Docs URLs: " + urls.join(", "));
  return urls;
}

/**
 * 件名から日付を抽出する
 */
function extractDateFromSubject(subject) {
  const datePatterns = [
    /(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\w{3} \d{1,2}, \d{4})/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日/  // Geminiメモの日本語日付対応
  ];

  for (let pattern of datePatterns) {
    const match = subject.match(pattern);
    if (match) {
      // 日本語日付パターンの場合はISO形式に変換
      if (match[2] && match[3]) {
        return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
      }
      return match[1];
    }
  }
  console.log('Debug: Unable to extract date from subject: ' + subject);
  return null;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    console.log('Debug: Invalid date string: ' + dateString);
    return formatDateGMT9(new Date());
  }
  return formatDateGMT9(date);
}

function formatDateGMT9(date) {
  const offset = 9 * 60;
  const localDate = new Date(date.getTime() + offset * 60000);
  return localDate.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * ファイルの拡張子を取得する（MIMEタイプ優先）
 * 動画ファイル（video/*）は .mp4 に統一する
 */
function getFileExtension(fileName, mimeType) {
  const mimeToExt = {
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'video/x-msvideo': '.avi', 'video/x-matroska': '.mkv',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
  };
  if (mimeType) {
    if (mimeToExt[mimeType]) return mimeToExt[mimeType];
    if (mimeType.startsWith('video/')) return '.mp4';
  }
  const parts = fileName.split('.');
  return parts.length > 1 ? '.' + parts.pop() : '';
}

function checkFilePermissions(file) {
  try {
    return {
      owners: file.getOwner() ? file.getOwner().getEmail() : 'Unable to get owner',
      editors: file.getEditors().map(e => e.getEmail()),
      viewers: file.getViewers().map(v => v.getEmail()),
      sharingAccess: file.getSharingAccess(),
      sharingPermission: file.getSharingPermission()
    };
  } catch (e) {
    console.error("Error checking file permissions: " + e.toString());
    return {error: e.toString()};
  }
}

/**
 * ヘッダー名の揺れに対応するヘルパー
 */
function findHeaderIndex(headers, candidates) {
  for (const name of candidates) {
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * SearchAndMoveシートから共通の設定データを読み取る
 */
function loadSheetConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const searchAndMoveSheet = ss.getSheetByName('SearchAndMove');
  const moveLogSheet = ss.getSheetByName('MoveLog');
  const searchData = searchAndMoveSheet.getDataRange().getValues();
  const headers = searchData.shift();

  const colIndex = {
    check: findHeaderIndex(headers, ['Check']) + 1,
    serial: findHeaderIndex(headers, ['Serial']) + 1,
    emailTo: findHeaderIndex(headers, ['EmailTo']) + 1,
    driveUrl: findHeaderIndex(headers, ['MoveToDriveURL', 'MoveTo_DriveURL', 'MoveToDrive']),
    webhook: findHeaderIndex(headers, ['Slack/Discord', 'SlackTo']),
    memo: findHeaderIndex(headers, ['Memo']),
  };

  const bgPink = PropertiesService.getScriptProperties().getProperty('BG_PINK') || '#FFB6C1';

  return { ss, searchAndMoveSheet, moveLogSheet, searchData, headers, colIndex, bgPink };
}

/**
 * 行データから共通フィールドを取得する
 */
function getRowFields(row, headers, colIndex) {
  return {
    meetingName: cleanCellValue(row[findHeaderIndex(headers, ['MeetingName'])]),
    renameTo: cleanCellValue(row[findHeaderIndex(headers, ['RenameTo'])]),
    serial: row[findHeaderIndex(headers, ['Serial'])],
    moveToDriveURL: colIndex.driveUrl >= 0 ? cleanCellValue(row[colIndex.driveUrl]) : '',
    emailToAddress: cleanCellValue(row[findHeaderIndex(headers, ['EmailTo'])]),
    webhookCell: colIndex.webhook >= 0 ? cleanCellValue(row[colIndex.webhook]) : '',
    memoFlag: colIndex.memo >= 0 ? cleanCellValue(row[colIndex.memo]).toLowerCase() : '',
  };
}

/**
 * 移動先フォルダの検証
 * @return {string|null} フォルダID。アクセス不可の場合はnullを返しCheck列にエラーを書き込む
 */
function validateDestinationFolder(moveToDriveURL, searchAndMoveSheet, rowIndex, checkColumnIndex, bgPink) {
  const moveToDriveId = getDriveIdFromUrl(moveToDriveURL);
  if (!moveToDriveId) {
    console.error("Invalid destination folder URL: " + moveToDriveURL);
    searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).setValue("Error: Invalid destination folder URL").setBackground(bgPink);
    return null;
  }
  try {
    const destinationFolder = DriveApp.getFolderById(moveToDriveId);
    console.log("Destination folder name: " + destinationFolder.getName());
    searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).clearContent().clearFormat();
    return moveToDriveId;
  } catch (folderError) {
    const errMsg = folderError.toString();
    console.error("Error accessing destination folder (ID: " + moveToDriveId + "): " + errMsg);
    let userMessage;
    if (errMsg.includes("is not found") || errMsg.includes("File not found") || errMsg.includes("does not exist")) {
      userMessage = `Error: フォルダが存在しません (ID: ${moveToDriveId})`;
    } else if (errMsg.includes("Access denied") || errMsg.includes("not have permission") || errMsg.includes("Forbidden")) {
      userMessage = `Error: フォルダへのアクセス権限がありません (ID: ${moveToDriveId})`;
    } else {
      userMessage = `Error: フォルダにアクセスできません (ID: ${moveToDriveId}): ${errMsg}`;
    }
    searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).setValue(userMessage).setBackground(bgPink);
    return null;
  }
}

// ============================================================
// 通知
// ============================================================

function sendWebhookNotifications(meetingWebhookCell, meetingName, processedFiles, destinationFolderUrl) {
  const message = createNotificationMessage(meetingName, processedFiles, destinationFolderUrl);
  const meetingWebhooks = parseWebhookUrls(meetingWebhookCell);
  const systemSlack = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK');
  const systemDiscord = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK');
  const allWebhooks = new Set();
  meetingWebhooks.forEach(url => allWebhooks.add(url));
  if (systemSlack) allWebhooks.add(systemSlack);
  if (systemDiscord) allWebhooks.add(systemDiscord);
  for (const webhookUrl of allWebhooks) {
    const type = detectWebhookType(webhookUrl);
    if (type === 'unknown') { console.log(`Unknown webhook type, skipping: ${webhookUrl}`); continue; }
    sendSingleWebhook(webhookUrl, type, message);
  }
}

function sendSingleWebhook(webhookUrl, type, message) {
  let sendMessage = message;
  if (type === 'discord' && sendMessage.length > 2000) {
    sendMessage = sendMessage.substring(0, 1997) + '...';
  }
  const payload = type === 'discord' ? { "content": sendMessage } : { "text": sendMessage };
  const options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
  try {
    const response = UrlFetchApp.fetch(webhookUrl, options);
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      console.log(`${type} notification sent successfully`);
    } else {
      console.error(`${type} notification failed (HTTP ${code}): ${response.getContentText()}`);
    }
  } catch (error) {
    console.error(`Error sending ${type} notification: ${error.toString()}`);
  }
}

function sendEmailNotification(meetingName, processedFiles, destinationFolderUrl, emailTo) {
  if (!emailTo) { console.log("No email addresses. Skipping."); return; }
  const message = createNotificationMessage(meetingName, processedFiles, destinationFolderUrl);
  const subject = "Meet録画/メモ移動通知: " + meetingName;
  const emailAddresses = emailTo.split(/[\s,;]+/).filter(e => e.trim() !== '');
  try {
    GmailApp.sendEmail(emailAddresses[0], subject, message, {
      cc: emailAddresses.slice(1).join(','),
      name: 'Meet録画管理システム'
    });
    console.log("Email notification sent.");
  } catch (error) {
    console.error("Error sending email: " + error.toString());
  }
}

function createNotificationMessage(meetingName, processedFiles, destinationFolderUrl) {
  if (!meetingName || !processedFiles || processedFiles.length === 0 || !destinationFolderUrl) {
    return "エラー: 通知メッセージの生成に必要な情報が不足しています。";
  }
  let message = `Meet会議 "${meetingName}" のファイル(${processedFiles.length}件)をフォルダに移動しました。\n`;
  message += `フォルダURL: ${destinationFolderUrl}\n\n移動したファイル:\n`;
  processedFiles.forEach(file => { message += `- ${file.name}: ${file.url}\n`; });
  return message;
}

// ============================================================
// ログ
// ============================================================

function logMove(sheet, meetingName, newName, movedTo, recFile, result) {
  sheet.setFrozenRows(1);
  const now = new Date();
  const lastRow = sheet.getLastRow() + 1;
  sheet.getRange(lastRow, 1).setValue(now).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  sheet.getRange(lastRow, 2).setValue(meetingName);
  sheet.getRange(lastRow, 3).setValue(newName);
  sheet.getRange(lastRow, 4).setValue(movedTo);
  sheet.getRange(lastRow, 5).setValue(recFile);
  sheet.getRange(lastRow, 6).setValue(result);
  if (result.startsWith('Moved') || result.startsWith('Memo')) {
    sheet.getRange(lastRow, 6).setBackground('lightgreen');
  }
  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
  dataRange.sort({column: 1, ascending: false});
  SpreadsheetApp.flush();
}

// ============================================================
// 録画ファイル処理（既存機能）
// ============================================================

function processFile(fileURL, subject, meetingName, renameTo, serial, moveToDriveId, moveToDriveURL, searchAndMoveSheet, moveLogSheet, rowIndex, checkColumnIndex) {
  console.log(`Processing file: ${fileURL}`);
  const fileId = getDriveIdFromUrl(fileURL);
  console.log(`Extracted File ID: ${fileId}`);

  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      console.log(`Original file name: ${file.getName()}`);
      const permissions = checkFilePermissions(file);
      console.log(`File permissions: ${JSON.stringify(permissions)}`);
      
      let dateString = extractDateFromSubject(subject);
      if (!dateString) {
        console.log("Failed to extract date from subject, using file creation date");
        dateString = formatDateGMT9(file.getDateCreated());
      } else {
        dateString = formatDate(dateString);
      }
      
      const fileExtension = getFileExtension(file.getName(), file.getMimeType());
      let newFileName;
      if (serial) {
        newFileName = `${renameTo}-${serial}-${dateString}${fileExtension}`;
      } else {
        newFileName = `${renameTo}-${dateString}${fileExtension}`;
      }
      file.setName(newFileName);
      console.log(`File renamed to: ${newFileName}`);
      
      try {
        const destinationFolder = DriveApp.getFolderById(moveToDriveId);
        file.moveTo(destinationFolder);
        console.log(`File moved to: ${destinationFolder.getName()}`);
      } catch (moveError) {
        throw new Error(`Failed to move file: ${moveError.message}`);
      }
      
      try {
        const owner = file.getOwner();
        if (owner) {
          DriveApp.getFolderById(moveToDriveId).addEditor(owner);
        }
      } catch (permError) {
        console.log(`Warning: Error updating permissions: ${permError.toString()}`);
      }
      
      logMove(moveLogSheet, meetingName, newFileName, moveToDriveURL, fileURL, 'Moved.');
      searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).clearContent().clearFormat();
      return { success: true, fileInfo: { name: newFileName, url: file.getUrl() } };
    } catch (e) {
      console.error(`Error processing file: ${e.toString()}`);
      let errorMessage = `Error: ${e.toString()}`;
      if (e.toString().includes("Invalid argument: id")) {
        errorMessage = `Error: No access to file or folder.`;
      } else if (e.toString().includes("Access denied")) {
        errorMessage = `Error: Access denied.`;
      }
      logMove(moveLogSheet, meetingName, '', moveToDriveURL, fileURL, errorMessage);
      searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).setValue(errorMessage).setBackground('#FFB6C1');
      return { success: false };
    }
  } else {
    const errorMessage = `Error: Invalid file ID`;
    logMove(moveLogSheet, meetingName, '', moveToDriveURL, fileURL, errorMessage);
    searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).setValue(errorMessage).setBackground('#FFB6C1');
    return { success: false };
  }
}

// ============================================================
// Geminiメモ処理（新機能）
// ============================================================

/**
 * ReplaceDictシートから置換辞書を読み込む
 * @return {Array<{before: string, after: string}>} 置換ペアの配列
 */
function loadReplaceDict() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dictSheet = ss.getSheetByName('ReplaceDict');
  if (!dictSheet) { console.log("ReplaceDict sheet not found."); return { dict: [], sheet: null }; }
  
  const data = dictSheet.getDataRange().getValues();
  const headers = data.shift(); // ヘッダー除去
  const countColIndex = headers.indexOf('Count');
  const dict = [];
  for (let i = 0; i < data.length; i++) {
    const before = String(data[i][0]).trim();
    const after = String(data[i][1]).trim();
    const currentCount = countColIndex >= 0 ? (parseInt(data[i][countColIndex]) || 0) : 0;
    if (before) {
      dict.push({ before, after, currentCount, sheetRow: i + 2, countCol: countColIndex + 1 });
    }
  }
  console.log(`Loaded ${dict.length} replacement rules from ReplaceDict`);
  return { dict, sheet: dictSheet };
}

/**
 * Google Docsに単語置換を適用し、ReplaceDictのCount列を更新する
 * @param {string} docId - Google DocsのID
 * @param {Array} replaceDict - 置換辞書（loadReplaceDictの.dict）
 * @param {GoogleAppsScript.Spreadsheet.Sheet} dictSheet - ReplaceDictシート
 * @return {number} 置換された単語の種類数（-1はエラー）
 */
function applyWordReplacements(docId, replaceDict, dictSheet) {
  if (!replaceDict || replaceDict.length === 0) return 0;
  
  try {
    const doc = DocumentApp.openById(docId);
    const body = doc.getBody();
    let replacedKinds = 0;
    
    for (const entry of replaceDict) {
      // findTextをループして出現回数をカウント
      let occurrences = 0;
      let searchResult = body.findText(entry.before);
      while (searchResult) {
        occurrences++;
        searchResult = body.findText(entry.before, searchResult);
      }
      
      if (occurrences > 0) {
        body.replaceText(entry.before, entry.after);
        console.log(`Replaced: "${entry.before}" → "${entry.after}" (${occurrences}箇所)`);
        replacedKinds++;
        
        // Count列を更新（累積加算）
        if (dictSheet && entry.countCol > 0) {
          const newCount = entry.currentCount + occurrences;
          dictSheet.getRange(entry.sheetRow, entry.countCol).setValue(newCount);
        }
      }
    }
    
    doc.saveAndClose();
    console.log(`Word replacement complete: ${replacedKinds} rules applied`);
    return replacedKinds;
  } catch (e) {
    console.error(`Error applying word replacements to doc ${docId}: ${e.toString()}`);
    return -1;
  }
}

/**
 * Geminiメモを処理する（移動 + 単語置換）
 * @param {string} docsURL - Google DocsのURL
 * @param {string} meetingName - ミーティング名
 * @param {string} renameTo - リネーム後のプレフィックス
 * @param {string} serial - シリアル番号
 * @param {string} dateString - 日付文字列（YYYYMMDD）
 * @param {string} moveToDriveId - 移動先フォルダID
 * @param {string} moveToDriveURL - 移動先フォルダURL
 * @param {string} memoFlag - メモ処理フラグ（move/replace）
 * @param {GoogleAppsScript.Spreadsheet.Sheet} moveLogSheet - ログシート
 * @return {Object} 処理結果
 */
function processGeminiMemo(docsURL, meetingName, renameTo, serial, dateString, moveToDriveId, moveToDriveURL, memoFlag, moveLogSheet) {
  const docId = getDriveIdFromUrl(docsURL);
  if (!docId) {
    const msg = 'Memo Error: Invalid Docs URL';
    logMove(moveLogSheet, meetingName, '', moveToDriveURL, docsURL, msg);
    return { success: false };
  }

  try {
    const file = DriveApp.getFileById(docId);
    console.log(`Gemini memo found: ${file.getName()}`);

    // 単語置換（replaceフラグの場合のみ）
    let replaceInfo = '';
    if (memoFlag === 'replace') {
      const { dict, sheet: dictSheet } = loadReplaceDict();
      const count = applyWordReplacements(docId, dict, dictSheet);
      if (count > 0) {
        replaceInfo = ` (${count}種の語句を置換)`;
      } else if (count < 0) {
        replaceInfo = ' (置換エラー)';
      }
    }

    // リネーム
    let newFileName;
    if (serial) {
      newFileName = `${renameTo}-Memo-${serial}-${dateString}`;
    } else {
      newFileName = `${renameTo}-Memo-${dateString}`;
    }
    file.setName(newFileName);
    console.log(`Memo renamed to: ${newFileName}`);

    // 移動
    const destinationFolder = DriveApp.getFolderById(moveToDriveId);
    file.moveTo(destinationFolder);
    console.log(`Memo moved to: ${destinationFolder.getName()}`);

    const result = `Memo moved.${replaceInfo}`;
    logMove(moveLogSheet, meetingName, newFileName, moveToDriveURL, docsURL, result);
    return { success: true, fileInfo: { name: newFileName, url: file.getUrl() } };

  } catch (e) {
    const errorMessage = `Memo Error: ${e.toString()}`;
    console.error(errorMessage);
    logMove(moveLogSheet, meetingName, '', moveToDriveURL, docsURL, errorMessage);
    return { success: false };
  }
}

// ============================================================
// メイン処理：録画ファイル
// ============================================================

function SearchAndMove() {
  const config = loadSheetConfig();
  const { searchAndMoveSheet, moveLogSheet, searchData, headers, colIndex, bgPink } = config;

  for (let i = 0; i < searchData.length; i++) {
    const row = searchData[i];
    const fields = getRowFields(row, headers, colIndex);
    const { meetingName, renameTo, webhookCell, emailToAddress, moveToDriveURL } = fields;
    let serial = fields.serial;

    console.log(`[Rec] Row ${i + 2}: ${meetingName}`);

    const moveToDriveId = validateDestinationFolder(moveToDriveURL, searchAndMoveSheet, i, colIndex.check, bgPink);
    if (!moveToDriveId) continue;

    const query = `is:unread subject:"${meetingName}" -from:gemini-notes@google.com`;
    const threads = GmailApp.search(query, 0, 10);
    threads.reverse();
    
    console.log("Search Gmail (rec) for: " + meetingName + " → " + threads.length + " threads");
    let newSerial = parseInt(serial);
    let processedAnyFiles = false;

    for (let thread of threads) {
      newSerial += 1;
      const messages = thread.getMessages();
      let threadProcessedFiles = [];
      let allOk = true;

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getBody();
        console.log("Processing email: " + subject);

        if (body.includes("The recording of the meeting might still be processing")) {
          console.log("Deleting processing notification");
          message.moveToTrash();
          continue;
        }
        
        const fileURLs = extractFileURLs(body);
        if (fileURLs.length > 0) {
          const processedURLs = new Set();
          for (let fileURL of fileURLs) {
            if (processedURLs.has(fileURL)) continue;
            const result = processFile(fileURL, subject, meetingName, renameTo, newSerial.toString(), moveToDriveId, moveToDriveURL, searchAndMoveSheet, moveLogSheet, i, colIndex.check);
            if (result.success) {
              threadProcessedFiles.push(result.fileInfo);
              processedURLs.add(fileURL);
              processedAnyFiles = true;
            } else {
              allOk = false;
            }
          }
        } else {
          console.log('Debug: No file links found in email');
        }
      }

      if (threadProcessedFiles.length > 0) {
        sendWebhookNotifications(webhookCell, meetingName, threadProcessedFiles, moveToDriveURL);
        sendEmailNotification(meetingName, threadProcessedFiles, moveToDriveURL, emailToAddress);
        if (allOk) thread.markRead();
      }
    }
    
    if (processedAnyFiles) {
      searchAndMoveSheet.getRange(i + 2, colIndex.serial).setValue(newSerial);
      console.log(`Updated serial for ${meetingName} to ${newSerial}`);
      return; // 1会議分処理したら終了
    }

    if (threads.length === 0) {
      console.log('No unread rec emails for: ' + meetingName);
    }
  }
}

// ============================================================
// メイン処理：Geminiメモ
// ============================================================

function SearchAndMoveMemo() {
  const config = loadSheetConfig();
  const { searchAndMoveSheet, moveLogSheet, searchData, headers, colIndex, bgPink } = config;

  for (let i = 0; i < searchData.length; i++) {
    const row = searchData[i];
    const fields = getRowFields(row, headers, colIndex);
    const { meetingName, renameTo, webhookCell, emailToAddress, moveToDriveURL, memoFlag } = fields;
    let serial = fields.serial;

    // Memo列が空またはskipならスキップ
    if (!memoFlag || memoFlag === 'skip') {
      console.log(`[Memo] Row ${i + 2}: ${meetingName} → skipped (Memo=${memoFlag || 'empty'})`);
      continue;
    }

    console.log(`[Memo] Row ${i + 2}: ${meetingName} (Memo=${memoFlag})`);

    const moveToDriveId = validateDestinationFolder(moveToDriveURL, searchAndMoveSheet, i, colIndex.check, bgPink);
    if (!moveToDriveId) continue;

    // Geminiメモメールを検索（件名に「」で囲まれた会議名が含まれる）
    const query = `is:unread from:gemini-notes@google.com subject:"${meetingName}"`;
    const threads = GmailApp.search(query, 0, 10);
    threads.reverse();

    console.log("Search Gmail (memo) for: " + meetingName + " → " + threads.length + " threads");
    let newSerial = parseInt(serial);
    let processedAnyMemos = false;

    for (let thread of threads) {
      newSerial += 1;
      const messages = thread.getMessages();
      let threadProcessedFiles = [];
      let allOk = true;

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getBody();
        console.log("Processing memo email: " + subject);

        // 日付を件名から取得
        let dateString = extractDateFromSubject(subject);
        if (!dateString) {
          dateString = formatDateGMT9(message.getDate());
        } else {
          dateString = formatDate(dateString);
        }

        // Google DocsのURLを抽出
        const docsURLs = extractDocsURLs(body);
        for (let docsURL of docsURLs) {
          const result = processGeminiMemo(docsURL, meetingName, renameTo, newSerial.toString(), dateString, moveToDriveId, moveToDriveURL, memoFlag, moveLogSheet);
          if (result.success) {
            threadProcessedFiles.push(result.fileInfo);
            processedAnyMemos = true;
          } else {
            allOk = false;
          }
        }
      }

      if (threadProcessedFiles.length > 0) {
        sendWebhookNotifications(webhookCell, meetingName, threadProcessedFiles, moveToDriveURL);
        sendEmailNotification(meetingName, threadProcessedFiles, moveToDriveURL, emailToAddress);
        if (allOk) thread.markRead();
      }
    }

    if (processedAnyMemos) {
      searchAndMoveSheet.getRange(i + 2, colIndex.serial).setValue(newSerial);
      console.log(`Updated serial for ${meetingName} to ${newSerial}`);
      return; // 1会議分処理したら終了
    }

    if (threads.length === 0) {
      console.log('No unread memo emails for: ' + meetingName);
    }
  }
}

// ============================================================
// スケジューラ
// ============================================================

function scheduledRun() {
  SearchAndMove();
  SearchAndMoveMemo();
}
