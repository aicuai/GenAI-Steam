/**
 * Meet Rec Manager
 * MeetRecSearchAndMove.gs
 * Coded by Akihiko Shirai
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
  
  let MeetingName = ""
  let movedFiles = [];
  let destinationFolderUrl = '';
  let emailTo = '';
  let slackTo = '';

  for (let i = 0; i < searchData.length; i++) {
    const row = searchData[i];
    const [meetingName, renameTo, serial, moveToDriveURL, emailToAddress, slackToEndpoint] = row;
    console.log(`Processing row ${i + 2}: MeetingName=${meetingName}, RenameTo=${renameTo}, Serial=${serial}, MoveToDriveURL=${moveToDriveURL}, EmailTo=${emailToAddress}, SlackTo=${slackToEndpoint}`);
    
    MeetingName = renameTo;
    emailTo = emailToAddress; // Store email address(es) for later use
    slackTo = slackToEndpoint; //個別Slack通知
    
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
      destinationFolderUrl = moveToDriveURL;
    } catch (folderError) {
      console.error("Error accessing destination folder: " + folderError.toString());
      searchAndMoveSheet.getRange(i + 2, checkColumnIndex).setValue("Error: Cannot access destination folder").setBackground('#FFB6C1');
      continue;
    }
    
    const query = `is:unread subject:"${meetingName}"`;
    const threads = GmailApp.search(query);
    
    console.log("Search Gmail for: " + meetingName);
    for (let thread of threads) {
      const messages = thread.getMessages();
      for (let message of messages) {
        const subject = message.getSubject();
        const body = message.getBody();
        
        console.log("Processing email: " + subject);
        console.log("Email body: " + body);

        // Check if this is a "processing" email and delete it
        if (body.includes("The recording of the meeting might still be processing. You'll be notified when it's ready.")) {
          console.log("Deleting processing notification email: " + subject);
          message.moveToTrash();
          continue;
        }
        
        const fileURLs = extractFileURLs(body);
        
        if (fileURLs.length > 0) {
          for (let fileURL of fileURLs) {
            const result = processFile(fileURL, subject, meetingName, renameTo, serial, moveToDriveId, moveToDriveURL, searchAndMoveSheet, moveLogSheet, i, checkColumnIndex);
            if (result.success) {
              movedFiles.push(result.fileInfo);
              // Update serial number if it was used
              if (serial) {
                const newSerial = parseInt(serial) + 1;
                searchAndMoveSheet.getRange(i + 2, serialColumnIndex).setValue(newSerial);
              }
            }
          }
          
          // Mark the email as read after processing
          message.markRead();
        } else {
          const errorMessage = 'Error: No file links found in email';
          console.log('Debug: ' + errorMessage);
          logMove(moveLogSheet, meetingName, '', moveToDriveURL, '', errorMessage);
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

  // Send notifications if files were moved
  if (movedFiles.length > 0) {
    sendSlackNotification(slackTo, MeetingName, movedFiles, destinationFolderUrl);
    sendEmailNotification(MeetingName, movedFiles, destinationFolderUrl, emailTo);
  }
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

/**
 * Slack通知を送信する
 * @param {Object[]} movedFiles - 移動されたファイルの情報
 * @param {string} destinationFolderUrl - 移動先フォルダURL
 */
function sendSlackNotification(MeetingSlackWebhook,meetingName, movedFiles, destinationFolderUrl) {
  const SystemSlackWebhook = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK');

  const message = createNotificationMessage(meetingName, movedFiles, destinationFolderUrl);
  const payload = {
    "text": message
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };


  if (!MeetingSlackWebhook) {
    console.log("MeetingSlackWebhook URL not set. Skipping notification.");
  } else {
   try {
     UrlFetchApp.fetch(MeetingSlackWebhook, options);
     console.log("Slack notification sent successfully.");
   } catch (error) {
     console.error("Error sending Slack notification: " + error.toString());
   }
  }


  if (!SystemSlackWebhook) {
    console.log("Slack webhook URL not set. Skipping notification.");
    return;
  } else {
   try {
     UrlFetchApp.fetch(SystemSlackWebhook, options);
     console.log("SystemSlackWebhook notification sent successfully.");
   } catch (error) {
     console.error("Error sending SystemSlackWebhook notification: " + error.toString());
   }
  }
}

/**
 * メール通知を送信する
 * @param {Object[]} movedFiles - 移動されたファイルの情報
 * @param {string} destinationFolderUrl - 移動先フォルダURL
 * @param {string} emailTo - 通知先メールアドレス（複数可）
 */
function sendEmailNotification(meetingName, movedFiles, destinationFolderUrl, emailTo) {
  if (!emailTo) {
    console.log("No email addresses provided. Skipping email notification.");
    return;
  }

  const message = createNotificationMessage(movedFiles, destinationFolderUrl);
  const subject = "Meet録画ファイル移動通知" + meetingName;

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

/**
 * 通知メッセージを作成する
 * @param {Object[]} movedFiles - 移動されたファイルの情報
 * @param {string} destinationFolderUrl - 移動先フォルダURL
 * @return {string} 作成された通知メッセージ
 */
function createNotificationMessage(meetingName, movedFiles, destinationFolderUrl) {
  let message = "Meet会議" + meetingName + " の録画をフォルダに移動しました。\n";
  message += `フォルダURL: ${destinationFolderUrl}\n\n移動したファイル:\n`;
  
  for (let file of movedFiles) {
    message += `- ${file.name}: ${file.url}\n`;
  }

  return message;
}

// Run the SearchAndMove function daily
function scheduledRun() {
  SearchAndMove();
}