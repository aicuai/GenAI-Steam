/**
 * Meet Rec Manager
 * MeetRecSearchAndMove.gs
 * Coded by Akihiko Shirai
 * https://github.com/aicuai/GenAI-Steam/blob/main/MeetRecSearchAndMove.gs
 * Gmailに届いたGoogle Meetの録画ファイルを自動で指定フォルダに移動するスクリプトです。
 * 処理の頻度は1時間に1回ぐらいでいいと思います。
 * メールの削除等は、通知メールに対しては削除します。成功したメールは既読になり、次回から処理対象にはなりません（コード中に削除できるようなコメントも書いてあるので好きに変更してください）。もちろん何が起きても保証はできません！
 * Script Property「SLACK_WEBHOOK」にSlackのIncoming WebhookのURLを渡すことでSlack通知を受け取れます。
 * Script Property「DISCORD_WEBHOOK」にDiscordのWebhookのURLを渡すことでDiscord通知を受け取れます。
 * いずれもシステム管理者向けの全体通知です。会議ごとの通知先は「Slack/Discord」列にWebhook URLを設定してください（URLから自動判定）。
 * 複数のWebhook URLを改行またはカンマ区切りで指定可能です。Slack/Discord混在もOKです。
 * 
 */
/**
 * スプレッドシートが開かれたときに実行される関数
 * カスタムメニューを追加し、主要機能へのアクセスを提供する
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('録画管理')
    .addItem('権限設定', 'getOAuthToken')
    .addItem('設定シート作成', 'createSetupSheets')
    .addItem('毎時起動設定', 'setHourlyTrigger')
    .addItem('即時処理', 'SearchAndMove')
    .addToUi();
}

/**
 * 必要なシート「SearchAndMove」と「MoveLog」を新規作成し、ヘッダ行を設定する
 */
function createSetupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // SearchAndMoveシートの作成
  let searchAndMoveSheet = ss.getSheetByName('SearchAndMove');
  if (!searchAndMoveSheet) {
    searchAndMoveSheet = ss.insertSheet('SearchAndMove');
    const searchAndMoveHeaders = ['MeetingName', 'RenameTo', 'Serial', 'MoveToDriveURL', 'EmailTo', 'Slack/Discord', 'Check'];
    searchAndMoveSheet.getRange(1, 1, 1, searchAndMoveHeaders.length).setValues([searchAndMoveHeaders]);
    searchAndMoveSheet.getRange(1, 1, 1, searchAndMoveHeaders.length).setFontWeight('bold');
    searchAndMoveSheet.setFrozenRows(1);
  } else {
    // 既存シートのマイグレーション: "SlackTo" → "Slack/Discord" にリネーム、"DiscordTo"列があれば統合して削除
    const existingHeaders = searchAndMoveSheet.getRange(1, 1, 1, searchAndMoveSheet.getLastColumn()).getValues()[0];
    const slackToIndex = existingHeaders.indexOf('SlackTo');
    const discordToIndex = existingHeaders.indexOf('DiscordTo');

    if (slackToIndex !== -1) {
      searchAndMoveSheet.getRange(1, slackToIndex + 1).setValue('Slack/Discord');
    }
    if (discordToIndex !== -1) {
      // DiscordTo列のデータをSlack/Discord列に統合してから列を削除
      const lastRow = searchAndMoveSheet.getLastRow();
      if (lastRow > 1 && slackToIndex !== -1) {
        for (let r = 2; r <= lastRow; r++) {
          const discordVal = searchAndMoveSheet.getRange(r, discordToIndex + 1).getValue();
          if (discordVal) {
            const slackVal = searchAndMoveSheet.getRange(r, slackToIndex + 1).getValue();
            const merged = slackVal ? slackVal + '\n' + discordVal : discordVal;
            searchAndMoveSheet.getRange(r, slackToIndex + 1).setValue(merged);
          }
        }
      }
      searchAndMoveSheet.deleteColumn(discordToIndex + 1);
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

  ui.alert('設定シートの作成が完了しました。');
}

/**
 * scheduledRunを1時間に1回実行するトリガーを設定する
 */
function setHourlyTrigger() {
  const ui = SpreadsheetApp.getUi();

  // 既存のトリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scheduledRun') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // 新しいトリガーを作成
  ScriptApp.newTrigger('scheduledRun')
    .timeBased()
    .everyHours(1)
    .create();

  ui.alert('毎時起動の設定が完了しました。');
}

/**
 * SearchAndMove関数を即時実行する
 */
function runSearchAndMoveNow() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    SearchAndMove();
    ui.alert('処理が完了しました。');
  } catch (error) {
    ui.alert('エラーが発生しました: ' + error.toString());
  }
}
// 必要なスコープを明示的に要求
function getOAuthToken() {
  DriveApp.getRootFolder();
  GmailApp.getInboxUnreadCount();
  SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Webhook URLからサービス種別を判定する
 * @param {string} url - Webhook URL
 * @return {string} 'slack', 'discord', または 'unknown'
 */
function detectWebhookType(url) {
  if (!url) return 'unknown';
  url = url.trim();
  if (url.includes('hooks.slack.com')) return 'slack';
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) return 'discord';
  return 'unknown';
}

/**
 * Webhook URLのセル値（改行・カンマ区切り対応）をパースして配列にする
 * @param {string} cellValue - セルの値
 * @return {string[]} Webhook URLの配列
 */
function parseWebhookUrls(cellValue) {
  if (!cellValue) return [];
  return String(cellValue)
    .split(/[\n,;]+/)
    .map(url => url.trim())
    .filter(url => url.length > 0);
}

/**
 * SearchAndMoveメイン関数：Gmailの未読メールを検索し、Meet録画ファイルを指定されたフォルダに移動する
 * - スプレッドシートから設定を読み込む
 * - 未読メールを検索し、ファイルリンクを抽出
 * - ファイルを移動し、名前を変更
 * - 処理結果をログに記録し、Slack/Discord通知とメール通知を送信
 */
function SearchAndMove() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  const searchAndMoveSheet = sheet.getSheetByName('SearchAndMove');
  const moveLogSheet = sheet.getSheetByName('MoveLog');
  
  const searchData = searchAndMoveSheet.getDataRange().getValues();
  const headers = searchData.shift(); // Remove header row
  const checkColumnIndex = headers.indexOf('Check') + 1;
  const serialColumnIndex = headers.indexOf('Serial') + 1;
  const emailToColumnIndex = headers.indexOf('EmailTo') + 1;
  const webhookColumnIndex = headers.indexOf('Slack/Discord') + 1;

  // Get background color from Script Properties
  const bgPink = PropertiesService.getScriptProperties().getProperty('BG_PINK') || '#FFB6C1';

  for (let i = 0; i < searchData.length; i++) {
    const row = searchData[i];
    const meetingName = row[headers.indexOf('MeetingName')];
    const renameTo = row[headers.indexOf('RenameTo')];
    let serial = row[headers.indexOf('Serial')];
    const moveToDriveURL = row[headers.indexOf('MoveToDriveURL')];
    const emailToAddress = row[headers.indexOf('EmailTo')];
    const webhookCell = webhookColumnIndex > 0 ? row[headers.indexOf('Slack/Discord')] : '';

    console.log(`Processing row ${i + 2}: MeetingName=${meetingName}, RenameTo=${renameTo}, Serial=${serial}, MoveToDriveURL=${moveToDriveURL}, EmailTo=${emailToAddress}, Webhooks=${webhookCell}`);
    
    const moveToDriveId = getDriveIdFromUrl(moveToDriveURL);

    if (!moveToDriveId) {
      console.error("Invalid destination folder URL: " + moveToDriveURL);
      searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue("Error: Invalid destination folder URL").setBackground(bgPink);
      continue;
    }

    // Verify folder exists and is accessible
    try {
      const destinationFolder = DriveApp.getFolderById(moveToDriveId);
      console.log("Destination folder name: " + destinationFolder.getName());
    } catch (folderError) {
      console.error("Error accessing destination folder: " + folderError.toString());
      searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue("Error: Cannot access destination folder").setBackground(bgPink);
      continue;
    }
    
    const query = `is:unread subject:"${meetingName}"`; //2024/9/20- 特に発信者指定しない方式に変更
    const threads = GmailApp.search(query, 0, 10); // Limit to 10 threads for safety
    threads.reverse(); // Process oldest first
    
    console.log("Search Gmail for: " + meetingName);
    let newSerial = parseInt(serial);
    let processedAnyFiles = false;

    for (let thread of threads) {
      newSerial += 1;  // Increment serial for each thread (email)
      const messages = thread.getMessages();
      let threadProcessedFiles = [];
      let allFilesProcessedSuccessfully = true;

      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getBody();
        
        console.log("Processing email: " + subject);

        // Check if this is a "processing" email and delete it
        if (body.includes("The recording of the meeting might still be processing. You'll be notified when it's ready.")) {
          console.log("Deleting processing notification email: " + subject);
          message.moveToTrash();
          continue;
        }
        
        const fileURLs = extractFileURLs(body);
        
        if (fileURLs.length > 0) {
          const processedURLs = new Set();

          for (let fileURL of fileURLs) {
            if (processedURLs.has(fileURL)) {
              console.log(`Skipping duplicate URL: ${fileURL}`);
              continue;
            }

            const result = processFile(fileURL, subject, meetingName, renameTo, newSerial.toString(), moveToDriveId, moveToDriveURL, searchAndMoveSheet, moveLogSheet, i, checkColumnIndex, bgPink);
            if (result.success) {
              threadProcessedFiles.push(result.fileInfo);
              processedURLs.add(fileURL);
              processedAnyFiles = true;
            } else {
              allFilesProcessedSuccessfully = false;
            }
          }
        } else {
          const errorMessage = 'Error: No file links found in email';
          console.log('Debug: ' + errorMessage);
          console.log(body);
        }
      }

      if (threadProcessedFiles.length > 0) {
        // Send webhook notifications (Slack/Discord auto-detected)
        sendWebhookNotifications(webhookCell, meetingName, threadProcessedFiles, moveToDriveURL);
        sendEmailNotification(meetingName, threadProcessedFiles, moveToDriveURL, emailToAddress);

        // Mark the thread as read if all files were processed successfully
        if (allFilesProcessedSuccessfully) {
          thread.markRead();
        }
      }
    }
    
    // Update the serial in the SearchAndMove sheet if any files were processed
    if (processedAnyFiles) {
      searchAndMoveSheet.getRange(i + 2, serialColumnIndex).setValue(newSerial);
      console.log(`Updated serial for ${meetingName} to ${newSerial}`);
    }

    if (threads.length === 0) {
      const message = 'No unread emails found';
      console.log(message + ' for: ' + meetingName);
    }

    // Exit the script after processing one meeting's emails
    if (processedAnyFiles) {
      console.log("Successfully processed files for one meeting. Exiting script.");
      return;
    }
  }
}

/**
 * Webhook通知を送信する（Slack/Discord自動判定）
 * 会議ごとのWebhook（Slack/Discord列）とシステム全体のWebhook（Script Properties）の両方に送信する
 * @param {string} meetingWebhookCell - 会議ごとのWebhook URLセル値（改行/カンマ区切り可）
 * @param {string} meetingName - ミーティング名
 * @param {Array} processedFiles - 処理されたファイル情報の配列
 * @param {string} destinationFolderUrl - 移動先フォルダURL
 */
function sendWebhookNotifications(meetingWebhookCell, meetingName, processedFiles, destinationFolderUrl) {
  const message = createNotificationMessage(meetingName, processedFiles, destinationFolderUrl);

  // 会議ごとのWebhook URLs
  const meetingWebhooks = parseWebhookUrls(meetingWebhookCell);

  // システム全体のWebhook URLs（Script Properties）
  const systemSlack = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK');
  const systemDiscord = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK');

  // 全Webhook URLを収集（重複排除）
  const allWebhooks = new Set();
  meetingWebhooks.forEach(url => allWebhooks.add(url));
  if (systemSlack) allWebhooks.add(systemSlack);
  if (systemDiscord) allWebhooks.add(systemDiscord);

  for (const webhookUrl of allWebhooks) {
    const type = detectWebhookType(webhookUrl);
    if (type === 'unknown') {
      console.log(`Unknown webhook type, skipping: ${webhookUrl}`);
      continue;
    }
    sendSingleWebhook(webhookUrl, type, message);
  }
}

/**
 * 単一のWebhookに通知を送信する
 * @param {string} webhookUrl - Webhook URL
 * @param {string} type - 'slack' または 'discord'
 * @param {string} message - 送信するメッセージ
 */
function sendSingleWebhook(webhookUrl, type, message) {
  let payload;
  let sendMessage = message;

  if (type === 'discord') {
    // Discord: 2000文字制限
    if (sendMessage.length > 2000) {
      sendMessage = sendMessage.substring(0, 1997) + '...';
    }
    payload = { "content": sendMessage };
  } else {
    // Slack
    payload = { "text": sendMessage };
  }

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(webhookUrl, options);
    const responseCode = response.getResponseCode();
    if (responseCode >= 200 && responseCode < 300) {
      console.log(`${type} notification sent successfully to: ${webhookUrl.substring(0, 50)}...`);
    } else {
      console.error(`${type} notification failed (HTTP ${responseCode}): ${response.getContentText()}`);
    }
  } catch (error) {
    console.error(`Error sending ${type} notification: ${error.toString()}`);
  }
}

function sendEmailNotification(meetingName, processedFiles, destinationFolderUrl, emailTo) {
  if (!emailTo) {
    console.log("No email addresses provided. Skipping email notification.");
    return;
  }

  const message = createNotificationMessage(meetingName, processedFiles, destinationFolderUrl);
  const subject = "Meet録画ファイル移動通知: " + meetingName;

  const emailAddresses = emailTo.split(/[\s,;]+/).filter(email => email.trim() !== '');

  try {
    GmailApp.sendEmail(emailAddresses[0], subject, message, {
      cc: emailAddresses.slice(1).join(','),
      name: 'Meet録画管理システム'
    });
    console.log("Email notification sent successfully.");
  } catch (error) {
    console.error("Error sending email notification: " + error.toString());
  }
}

function createNotificationMessage(meetingName, processedFiles, destinationFolderUrl) {
  if (!meetingName || !processedFiles || processedFiles.length === 0 || !destinationFolderUrl) {
    console.error("Missing information for notification message:", { meetingName, processedFiles, destinationFolderUrl });
    return "エラー: 通知メッセージの生成に必要な情報が不足しています。";
  }

  let message = `Meet会議 "${meetingName}" の録画ファイル(${processedFiles.length}件)をフォルダに移動しました。\n`;
  message += `フォルダURL: ${destinationFolderUrl}\n\n移動したファイル:\n`;
  processedFiles.forEach(file => {
    message += `- ${file.name}: ${file.url}\n`;
  });

  return message;
}

/**
 * URLからGoogle DriveのファイルIDまたはフォルダIDを抽出する
 * @param {string} url - Google DriveのURL
 * @return {string|null} 抽出されたIDまたはnull
 */
function getDriveIdFromUrl(url) {
  console.log("Extracting Drive ID from URL: " + url);
  
  // 対応1: /folders/パターン
  let match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) {
    console.log("Extracted folder ID from /folders/: " + match[1]);
    return match[1];
  }

  // 対応2: open?id=
  if (url.includes('open?id=')) {
    const id = url.split('open?id=')[1].split('&')[0];
    console.log("Extracted file ID from open?id= URL: " + id);
    return id;
  }

  // 対応3: /d/パターン
  match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) {
    console.log("Extracted file ID from /d/ URL: " + match[1]);
    return match[1];
  }

  console.log("Failed to extract Drive ID from URL");
  return null;
}

/**
 * メール本文からGoogle DriveのファイルURLを抽出する
 * @param {string} body - メール本文
 * @return {string[]} 抽出されたファイルURLの配列
 */
function extractFileURLs(body) {
  const regex = /href="(https:\/\/drive\.google\.com\/(?:open\?id=|file\/d\/)[a-zA-Z0-9-_]+(?:\/view)?[^"]*)"/g;
  const matches = body.matchAll(regex);
  const urls = [];
  for (const match of matches) {
    urls.push(match[1]);
  }
  console.log("Extracted file URLs: " + urls.join(", "));
  return urls;
}

/**
 * ファイルを処理する（名前変更、移動、権限設定）
 * @param {string} fileURL - ファイルのURL
 * @param {string} subject - メールの件名
 * @param {string} meetingName - ミーティング名
 * @param {string} renameTo - リネーム後のファイル名プレフィックス
 * @param {string} serial - シリアル番号（オプション）
 * @param {string} moveToDriveId - 移動先フォルダID
 * @param {string} moveToDriveURL - 移動先フォルダURL
 * @param {GoogleAppsScript.Spreadsheet.Sheet} searchAndMoveSheet - 設定シート
 * @param {GoogleAppsScript.Spreadsheet.Sheet} moveLogSheet - ログシート
 * @param {number} rowIndex - 処理中の行インデックス
 * @param {number} checkColumnIndex - チェック列のインデックス
 * @return {Object} 処理結果と移動したファイル情報
 */
function processFile(fileURL, subject, meetingName, renameTo, serial, moveToDriveId, moveToDriveURL, searchAndMoveSheet, moveLogSheet, rowIndex, checkColumnIndex) {
  console.log(`Processing file: ${fileURL}`);
  const fileId = getDriveIdFromUrl(fileURL);
  console.log(`Extracted File ID: ${fileId}`);

  if (fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      console.log(`Original file name: ${file.getName()}`);
      
      // Check file permissions
      const permissions = checkFilePermissions(file);
      console.log(`File permissions: ${JSON.stringify(permissions)}`);
      
      // Get date from email subject or file creation date
      let dateString = extractDateFromSubject(subject);
      if (!dateString) {
        console.log("Failed to extract date from subject, using file creation date");
        dateString = formatDateGMT9(file.getDateCreated());
      } else {
        dateString = formatDate(dateString);
      }
      
      // Construct new file name
      const fileExtension = getFileExtension(file.getName());
      let newFileName;
      if (serial) {
        newFileName = `${renameTo}-${serial}-${dateString}${fileExtension}`;
      } else {
        newFileName = `${renameTo}-${dateString}${fileExtension}`;
      }
      file.setName(newFileName);
      console.log(`File renamed to: ${newFileName}`);
      
      // Move the file
      try {
        const destinationFolder = DriveApp.getFolderById(moveToDriveId);
        file.moveTo(destinationFolder);
        console.log(`File moved to destination folder: ${destinationFolder.getName()}`);
      } catch (moveError) {
        console.error(`Error moving file: ${moveError.toString()}`);
        throw new Error(`Failed to move file: ${moveError.message}`);
      }
      
      // Set permissions (you may need to adjust this based on your specific requirements)
      try {
        const owner = file.getOwner();
        if (owner) {
          DriveApp.getFolderById(moveToDriveId).addEditor(owner);
          console.log(`File permissions updated for owner: ${owner.getEmail()}`);
        } else {
          console.log(`Warning: Unable to get file owner`);
        }
      } catch (permError) {
        console.log(`Warning: Error updating file permissions: ${permError.toString()}`);
      }
      
      // Log the result
      const result = 'Moved.';
      logMove(moveLogSheet, meetingName, newFileName, moveToDriveURL, fileURL, result);
      console.log(`File processing completed successfully`);
      
      // Clear the Check column
      searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).clearContent().clearFormat();

      return { success: true, fileInfo: { name: newFileName, url: file.getUrl() } };
    } catch (e) {
      console.error(`Error processing file: ${e.toString()}`);
      let errorMessage = `Error: ${e.toString()}`;
      if (e.toString().includes("Invalid argument: id")) {
        errorMessage = `Error: No access to file or folder. Check permissions.`;
      } else if (e.toString().includes("Access denied")) {
        errorMessage = `Error: Access denied. Insufficient permissions for file.`;
      }
      
      logMove(moveLogSheet, meetingName, '', moveToDriveURL, fileURL, errorMessage);
      
      // Set error message and pink background in Check column
      const checkCell = searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex);
      checkCell.setValue(errorMessage).setBackground('#FFB6C1');

      return { success: false };
    }
  } else {
    const errorMessage = `Error: Invalid file ID`;
    console.log(`Debug: ${errorMessage}`);
    logMove(moveLogSheet, meetingName, '', moveToDriveURL, fileURL, errorMessage);
    searchAndMoveSheet.getRange(rowIndex + 2, checkColumnIndex).setValue(errorMessage).setBackground('#FFB6C1');
    return { success: false };
  }
}

/**
 * ファイル名から拡張子を取得する
 * @param {string} fileName - ファイル名
 * @return {string} ファイルの拡張子（ドット含む）
 */
function getFileExtension(fileName) {
  const parts = fileName.split('.');
  return parts.length > 1 ? '.' + parts.pop() : '';
}

/**
 * 件名から日付を抽出する
 * @param {string} subject - メールの件名
 * @return {string|null} 抽出された日付文字列またはnull
 */
function extractDateFromSubject(subject) {
  const datePatterns = [
    /(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\w{3} \d{1,2}, \d{4})/
  ];

  for (let pattern of datePatterns) {
    const match = subject.match(pattern);
    if (match) {
      return match[1];
    }
  }

  console.log('Debug: Unable to extract date from subject: ' + subject);
  return null;
}
/**
 * 日付文字列をフォーマットする
 * @param {string} dateString - 日付文字列
 * @return {string} フォーマットされた日付文字列（YYYYMMDD形式）
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    console.log('Debug: Invalid date string: ' + dateString);
    return formatDateGMT9(new Date());
  }
  
  return formatDateGMT9(date);
}

/**
 * 日付をGMT+9（日本時間）でフォーマットする
 * @param {Date} date - 日付オブジェクト
 * @return {string} フォーマットされた日付文字列（YYYYMMDD形式）
 */
function formatDateGMT9(date) {
  const offset = 9 * 60; // GMT+9 offset in minutes
  const localDate = new Date(date.getTime() + offset * 60000);
  return localDate.toISOString().split('T')[0].replace(/-/g, '');
}

/**
 * ファイルの権限情報を取得する
 * @param {GoogleAppsScript.Drive.File} file - Driveファイルオブジェクト
 * @return {Object} ファイルの権限情報
 */
function checkFilePermissions(file) {
  try {
    const permissions = {
      owners: file.getOwner() ? file.getOwner().getEmail() : 'Unable to get owner',
      editors: file.getEditors().map(editor => editor.getEmail()),
      viewers: file.getViewers().map(viewer => viewer.getEmail()),
      sharingAccess: file.getSharingAccess(),
      sharingPermission: file.getSharingPermission()
    };
    return permissions;
  } catch (e) {
    console.error("Error checking file permissions: " + e.toString());
    return {error: e.toString()};
  }
}

/**
 * 移動操作をログに記録し、シートを更新する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - ログを記録するシート
 * @param {string} meetingName - ミーティング名
 * @param {string} newName - 新しいファイル名
 * @param {string} movedTo - 移動先フォルダURL
 * @param {string} recFile - 元のファイルURL
 * @param {string} result - 処理結果
 */
function logMove(sheet, meetingName, newName, movedTo, recFile, result) {
  // 1行目を固定
  sheet.setFrozenRows(1);

  const now = new Date();
  const lastRow = sheet.getLastRow() + 1;
  
  // 新しいログエントリを追加
  sheet.getRange(lastRow, 1).setValue(now).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  sheet.getRange(lastRow, 2).setValue(meetingName);
  sheet.getRange(lastRow, 3).setValue(newName);
  sheet.getRange(lastRow, 4).setValue(movedTo);
  sheet.getRange(lastRow, 5).setValue(recFile);
  sheet.getRange(lastRow, 6).setValue(result);
  
  if (result === 'Moved.') {
    sheet.getRange(lastRow, 6).setBackground('lightgreen');
  }

  // データ範囲を取得（1行目のヘッダーを除く）
  const dataRange = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());

  // A列（ProceedTime）で降順にソート
  dataRange.sort({column: 1, ascending: false});

  // 変更を適用
  SpreadsheetApp.flush();
}

// Run the SearchAndMove function daily
function scheduledRun() {
  SearchAndMove();
}
