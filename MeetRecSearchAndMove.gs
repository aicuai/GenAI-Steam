/**
 * Meet Rec Manager
 * MeetRecSearchAndMove.gs
 * Coded by Akihiko Shirai
 * https://github.com/aicuai/GenAI-Steam/blob/main/MeetRecSearchAndMove.gs
 * Gmailに届いたGoogle Meetの録画ファイルを自動で指定フォルダに移動するスクリプトです。
 * 処理の頻度は1時間に1回ぐらいでいいと思います。
 * メールの削除等は、通知メールに対しては削除します。成功したメールは既読になり、次回から処理対象にはなりません（コード中に削除できるようなコメントも書いてあるので好きに変更してください）。もちろん何が起きても保証はできません！
 * Script Property「SLACK_WEBHOOK」にSlackのIncoming WebhookのURLを渡すことで通知を受け取れます。これはメール受信者（このシステムの管理者）向けで、会議の受信者向けはシート上でメールアドレスとSlack通知を別途設定できます。
 * 
 */

// 必要なスコープを明示的に要求
function getOAuthToken() {
  DriveApp.getRootFolder();
  GmailApp.getInboxUnreadCount();
  SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * SearchAndMoveメイン関数：Gmailの未読メールを検索し、Meet録画ファイルを指定されたフォルダに移動する
 * - スプレッドシートから設定を読み込む
 * - 未読メールを検索し、ファイルリンクを抽出
 * - ファイルを移動し、名前を変更
 * - 処理結果をログに記録し、Slack通知とメール通知を送信
 * - メールの検索を古い順に処理するように変更します。
 * - ファイルの処理に成功したら、スクリプトを終了するように修正します。
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
  const slackToColumnIndex = headers.indexOf('SlackTo') + 1;

  for (let i = 0; i < searchData.length; i++) {
    const row = searchData[i];
    const [meetingName, renameTo, serial, moveToDriveURL, emailToAddress, slackToEndpoint] = row;
    console.log(`Processing row ${i + 2}: MeetingName=${meetingName}, RenameTo=${renameTo}, Serial=${serial}, MoveToDriveURL=${moveToDriveURL}, EmailTo=${emailToAddress}, SlackTo=${slackToEndpoint}`);
    
    const moveToDriveId = getDriveIdFromUrl(moveToDriveURL);

    if (!moveToDriveId) {
      console.error("Invalid destination folder URL: " + moveToDriveURL);
      searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue("Error: Invalid destination folder URL").setBackground('#FFB6C1');
      continue;
    }

    // Verify folder exists and is accessible
    try {
      const destinationFolder = DriveApp.getFolderById(moveToDriveId);
      console.log("Destination folder name: " + destinationFolder.getName());
    } catch (folderError) {
      console.error("Error accessing destination folder: " + folderError.toString());
      searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue("Error: Cannot access destination folder").setBackground('#FFB6C1');
      continue;
    }
    
    const query = `is:unread subject:"${meetingName}" from:meet-recordings-noreply@google.com`;
    const threads = GmailApp.search(query, 0, 10); // Limit to 10 threads for safety
    threads.reverse(); // Process oldest first
    
    console.log("Search Gmail for: " + meetingName);
    for (let thread of threads) {
      const messages = thread.getMessages();
      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getBody();
        
        console.log("Processing email: " + subject);

        // Check if this is a "processing" email and delete it
        if (body.includes("The recording of the meeting might still be processing. You'll be notified when it's ready.")) {
          console.log("Deleting processing notification email: " + subject);
          message.moveToTrash(); //処理中の通知メールは不要ですよね
          continue;
        }
        
        const fileURLs = extractFileURLs(body);
        
        if (fileURLs.length > 0) {
          const processedFiles = [];
          const processedURLs = new Set(); // 追加: 処理済みURLを追跡するためのSet
          let allFilesProcessedSuccessfully = true;

          for (let fileURL of fileURLs) {
            // 追加: URLが既に処理済みの場合はスキップ
            if (processedURLs.has(fileURL)) {
              console.log(`Skipping duplicate URL: ${fileURL}`);
              continue;
            }

            const result = processFile(fileURL, subject, meetingName, renameTo, serial, moveToDriveId, moveToDriveURL, searchAndMoveSheet, moveLogSheet, i, checkColumnIndex);
            if (result.success) {
              processedFiles.push(result.fileInfo);
              processedURLs.add(fileURL); // 追加: 処理済みURLをSetに追加
            } else {
              allFilesProcessedSuccessfully = false;
            }
          }

          if (processedFiles.length > 0) {
            // Send notifications for all processed files in this email
            sendSlackNotification(slackToEndpoint, meetingName, processedFiles, moveToDriveURL);
            sendEmailNotification(meetingName, processedFiles, moveToDriveURL, emailToAddress);

            // Mark the email as read if all files were processed successfully
            if (allFilesProcessedSuccessfully) {
              message.markRead();        //もし削除したかったら  message.moveToTrash();
            }

            // Exit the script after processing one email
            console.log("Successfully processed files from one email. Exiting script.");
            return;
          }
        } else {
          const errorMessage = 'Error: No file links found in email';
          console.log('Debug: ' + errorMessage);
          logMove(moveLogSheet, meetingName, '', moveToDriveURL, 'N/A', errorMessage);
          searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue(errorMessage).setBackground('#FFB6C1');
        }
      }
    }
    
    if (threads.length === 0) {
      const message = 'No unread emails found';
      console.log(message + ' for: ' + meetingName);
      searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue(message).setBackground('#FFB6C1');
    }
  }
}

function sendSlackNotification(meetingSlackWebhook, meetingName, processedFiles, destinationFolderUrl) {
  const systemSlackWebhook = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK');

  const message = createNotificationMessage(meetingName, processedFiles, destinationFolderUrl);
  const payload = {
    "text": message
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };

  // Send to meeting-specific Slack if webhook is provided
  if (meetingSlackWebhook) {
    try {
      UrlFetchApp.fetch(meetingSlackWebhook, options);
      console.log("Meeting-specific Slack notification sent successfully.");
    } catch (error) {
      console.error("Error sending meeting-specific Slack notification: " + error.toString());
    }
  }

  // Always send to system Slack
  if (systemSlackWebhook) {
    try {
      UrlFetchApp.fetch(systemSlackWebhook, options);
      console.log("System Slack notification sent successfully.");
    } catch (error) {
      console.error("Error sending system Slack notification: " + error.toString());
    }
  } else {
    console.log("System Slack webhook URL not set. Skipping system notification.");
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
  if (url.startsWith('https://drive.google.com/drive/folders/')) {
    const id = url.split('/').pop();
    console.log("Extracted folder ID: " + id);
    return id;
  }
  
  if (url.includes('open?id=')) {
    const id = url.split('open?id=')[1].split('&')[0];
    console.log("Extracted file ID from open?id= URL: " + id);
    return id;
  }
  
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
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
      let newFileName = `${renameTo}-${serial}-${dateString}${fileExtension}`;
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
 * 移動操作をログに記録する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - ログを記録するシート
 * @param {string} meetingName - ミーティング名
 * @param {string} newName - 新しいファイル名
 * @param {string} movedTo - 移動先フォルダURL
 * @param {string} recFile - 元のファイルURL
 * @param {string} result - 処理結果
 */
function logMove(sheet, meetingName, newName, movedTo, recFile, result) {
  const now = new Date();
  const lastRow = sheet.getLastRow() + 1;
  
  sheet.getRange(lastRow, 1).setValue(now).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  sheet.getRange(lastRow, 2).setValue(meetingName);
  sheet.getRange(lastRow, 3).setValue(newName);
  sheet.getRange(lastRow, 4).setValue(movedTo);
  sheet.getRange(lastRow, 5).setValue(recFile);
  sheet.getRange(lastRow, 6).setValue(result);
  
  if (result === 'Moved.') {
    sheet.getRange(lastRow, 6).setBackground('lightgreen');
  }
}


// Run the SearchAndMove function daily
function scheduledRun() {
  SearchAndMove();
}
