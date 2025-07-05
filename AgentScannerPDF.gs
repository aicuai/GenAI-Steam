/**
 * AgentScannerPDF.gs
 * PDF整理・Discord通知システム
 * ver.1.0
 * by Dr.(Shirai)Hakase X@o_ob
 * 
 * 設定方法：
 * 1. スプレッドシートのメニュー「Scanner管理」から「設定」を選択
 * 2. 必要な設定値を入力
 * 3. 「トリガー設定」でWatchNewFile()の自動実行を設定
 */

/**
 * スプレッドシート開封時にカスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Scanner管理')
    .addItem('📋 設定', 'showSettingsDialog')
    .addItem('⚙️ トリガー設定', 'setupTrigger')
    .addItem('🔍 手動チェック', 'manualCheck')
    .addItem('🧪 設定テスト', 'testConfig')
    .addSeparator()
    .addItem('❌ トリガー削除', 'deleteTrigger')
    .addToUi();
}

/**
 * メイン関数：新しいPDFファイルを監視
 */
function WatchNewFile() {
  try {
    console.log('新しいPDFファイルの監視を開始...');
    
    // 設定値を取得
    const config = getConfig();
    if (!config) {
      console.log('設定が不完全です。処理を中止します。');
      return;
    }
    
    // PDFシートを取得または作成
    const sheet = getPDFSheet();
    
    // 新しいPDFファイルをチェック
    const newFiles = getNewPDFFiles(config.folderId, sheet);
    
    if (newFiles.length > 0) {
      console.log(`新しいPDFファイルを${newFiles.length}件発見しました`);
      
      // 各ファイルを処理
      newFiles.forEach(file => {
        processNewPDF(file, sheet, config.webhook);
      });
      
      // 完了通知
      const summaryMessage = `✅ ${newFiles.length}件の新しいPDFファイルを処理しました`;
      console.log(summaryMessage);
      
    } else {
      console.log('新しいPDFファイルは見つかりませんでした');
    }
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
    
    // エラーもDiscordに通知
    const webhook = PropertiesService.getScriptProperties().getProperty('WEBHOOK');
    if (webhook) {
      const errorMessage = `❌ **システムエラー発生**

⚠️ PDF監視でエラーが発生しました

📝 **エラー内容**
\`${error.message}\`

🕒 **発生時刻**
${formatDateTime(new Date())}

---
🔧 *設定を確認してください*`;
      sendDiscordNotification(webhook, errorMessage);
    }
  }
}

/**
 * 設定値を取得（スクリプトプロパティから）
 */
function getConfig() {
  const properties = PropertiesService.getScriptProperties();
  const webhook = properties.getProperty('WEBHOOK');
  const folderId = properties.getProperty('FOLDER_ID');
  
  if (!webhook || !folderId) {
    console.log('設定が不足しています');
    return null;
  }
  
  return { webhook, folderId };
}

/**
 * 設定ダイアログを表示
 */
function showSettingsDialog() {
  const properties = PropertiesService.getScriptProperties();
  const currentWebhook = properties.getProperty('WEBHOOK') || '';
  const currentFolderId = properties.getProperty('FOLDER_ID') || '';
  
  const ui = SpreadsheetApp.getUi();
  
  // Discord Webhook URL の入力
  const webhookResult = ui.prompt(
    'Discord Webhook URL設定',
    `現在の設定: ${currentWebhook ? currentWebhook.substring(0, 50) + '...' : '未設定'}

新しいDiscord Webhook URLを入力してください:
※Discordサーバーの設定 > 連携サービス > ウェブフック で取得`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (webhookResult.getSelectedButton() === ui.Button.CANCEL) {
    return;
  }
  
  const webhookUrl = webhookResult.getResponseText().trim();
  if (webhookUrl && !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    ui.alert('エラー', 'Discord Webhook URLの形式が正しくありません', ui.ButtonSet.OK);
    return;
  }
  
  // Google Drive フォルダID の入力
  const folderResult = ui.prompt(
    'Google Drive フォルダID設定',
    `現在の設定: ${currentFolderId || '未設定'}

ScanSnapが保存するGoogle DriveフォルダのIDを入力してください:
※フォルダURLの「folders/」以降の部分
例: https://drive.google.com/drive/folders/1ABcdefGHijklMNopqRSTuvwxyz`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (folderResult.getSelectedButton() === ui.Button.CANCEL) {
    return;
  }
  
  const folderId = folderResult.getResponseText().trim();
  
  // 設定を保存
  if (webhookUrl) {
    properties.setProperty('WEBHOOK', webhookUrl);
  }
  if (folderId) {
    properties.setProperty('FOLDER_ID', folderId);
  }
  
  ui.alert('設定完了', '設定が保存されました。「設定テスト」で動作確認を行ってください。', ui.ButtonSet.OK);
}

/**
 * PDFシートを取得または作成
 */
function getPDFSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('PDF');
  
  if (!sheet) {
    // シートが存在しない場合は新規作成
    sheet = spreadsheet.insertSheet('PDF');
    
    // ヘッダー行を設定
    const headers = ['書類日付', '作成日時', '追加日時', 'ファイル名', 'GoogleDriveURL', 'ファイルID'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // ヘッダー行をフォーマット
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#E8F0FE');
    headerRange.setHorizontalAlignment('center');
    
    // 列幅を調整
    sheet.setColumnWidth(1, 100); // 書類日付
    sheet.setColumnWidth(2, 100); // 作成日時
    sheet.setColumnWidth(3, 100); // 追加日時
    sheet.setColumnWidth(4, 250); // ファイル名
    sheet.setColumnWidth(5, 300); // GoogleDriveURL
    sheet.setColumnWidth(6, 200); // ファイルID
    
    console.log('PDFシートを新規作成しました');
  }
  
  return sheet;
}

/**
 * 新しいPDFファイルを取得
 */
function getNewPDFFiles(folderId, sheet) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFilesByType(MimeType.PDF);
    
    // 既存のファイルIDを取得
    const existingData = sheet.getDataRange().getValues();
    const existingFileIds = existingData.slice(1).map(row => row[5]); // ファイルID列
    
    const newFiles = [];
    
    while (files.hasNext()) {
      const file = files.next();
      const fileId = file.getId();
      
      // 既に記録されているファイルはスキップ
      if (!existingFileIds.includes(fileId)) {
        // ScanSnapの命名規則に従うファイルのみ処理
        if (isScanSnapFile(file.getName())) {
          newFiles.push(file);
        }
      }
    }
    
    return newFiles;
    
  } catch (error) {
    console.error('フォルダアクセスエラー:', error);
    throw new Error(`フォルダにアクセスできません: ${error.message}`);
  }
}

/**
 * ScanSnapの命名規則かチェック
 */
function isScanSnapFile(fileName) {
  // YYYYMMDD_(タイトル).pdf の形式をチェック
  const pattern = /^\d{8}_.*\.pdf$/i;
  return pattern.test(fileName);
}

/**
 * 新しいPDFファイルを処理
 */
function processNewPDF(file, sheet, webhook) {
  try {
    // ファイル名を解析
    const fileName = file.getName();
    const docDate = parseDateFromFileName(fileName);
    const createdDate = formatDate(file.getDateCreated());
    const addedDate = formatDate(new Date());
    const driveUrl = file.getUrl();
    const fileId = file.getId();
    
    // シートに記録
    const newRow = [
      docDate,        // 書類日付
      createdDate,    // 作成日時
      addedDate,      // 追加日時
      fileName,       // ファイル名
      driveUrl,       // GoogleDriveURL
      fileId          // ファイルID
    ];
    
    sheet.appendRow(newRow);
    
    // 行の書式設定
    const lastRow = sheet.getLastRow();
    const dataRange = sheet.getRange(lastRow, 1, 1, 6);
    dataRange.setHorizontalAlignment('left');
    
    // Discordに通知
    const title = parseTitleFromFileName(fileName);
    const fileSize = formatFileSize(file.getSize());
    const createdDateTime = formatDateTime(file.getDateCreated());
    const message = `📄 **新しいPDF \`${fileName}\` が追加されました**
🔗 **Google Driveリンク** [ファイルを開く](${driveUrl})
📊 **ファイルサイズ** ${fileSize}
🕒 **作成日時** ${createdDateTime}
`;
    sendDiscordNotification(webhook, message);
    
    console.log(`処理完了: ${fileName}`);
    
  } catch (error) {
    console.error(`ファイル処理エラー (${file.getName()}):`, error);
    throw error;
  }
}

/**
 * 日付を「2025/05/31」形式でフォーマット
 */
function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}

/**
 * 日時を「2025-07-05 16:37:05」形式でフォーマット
 */
function formatDateTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/**
 * 時刻を「16:46」形式でフォーマット
 */
function formatTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm');
}

/**
 * ファイルサイズを読みやすい形式でフォーマット
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * ファイル名から日付を解析
 */
function parseDateFromFileName(fileName) {
  // YYYYMMDD_ の部分を抽出
  const match = fileName.match(/^(\d{4})(\d{2})(\d{2})_/);
  if (match) {
    const year = match[1];
    const month = match[2];
    const day = match[3];
    return `${year}/${month}/${day}`;
  }
  return '不明';
}

/**
 * ファイル名からタイトルを解析
 */
function parseTitleFromFileName(fileName) {
  // YYYYMMDD_ の後の部分を抽出（拡張子を除く）
  const match = fileName.match(/^\d{8}_(.+)\.pdf$/i);
  if (match) {
    return match[1];
  }
  return fileName; // パターンに合わない場合はファイル名をそのまま返す
}

/**
 * Discord Webhookで通知送信
 */
function sendDiscordNotification(webhook, message) {
  try {
    const payload = {
      content: message,
      username: 'Scanner Agent by Dr.(Shirai)Hakase X@o_ob',
      avatar_url: 'https://raw.githubusercontent.com/aicuai/GenAI-Steam/refs/heads/main/pdf-512x512.png'
    };
    
    const options = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    };
    
    const response = UrlFetchApp.fetch(webhook, options);
    
    if (response.getResponseCode() !== 204) {
      throw new Error(`Discord通知エラー: ${response.getResponseCode()}`);
    }
    
    console.log('Discord通知送信完了');
    
  } catch (error) {
    console.error('Discord通知送信エラー:', error);
    throw error;
  }
}

/**
 * 手動実行用：設定テスト
 */
function testConfig() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const config = getConfig();
    if (!config) {
      ui.alert('設定エラー', '設定が不完全です。「設定」から必要な項目を入力してください。', ui.ButtonSet.OK);
      return;
    }
    
    // フォルダアクセステスト
    const folder = DriveApp.getFolderById(config.folderId);
    const folderName = folder.getName();
    
    // テスト通知
    const testMessage = `🧪 **テスト通知**

🔧 PDF監視システムのテスト通知です

📁 **監視フォルダ**
\`${folderName}\`

🆔 **フォルダID**
\`${config.folderId}\`

🕒 **テスト実行時刻**
${formatDateTime(new Date())}

---
✅ *システムが正常に動作しています！*`;
    
    sendDiscordNotification(config.webhook, testMessage);
    
    ui.alert('テスト完了', 
      `設定テストが完了しました。\n\n` +
      `フォルダ名: ${folderName}\n` +
      `Discord通知: 送信成功\n\n` +
      `Discordでテスト通知を確認してください。`, 
      ui.ButtonSet.OK);
    
  } catch (error) {
    console.error('設定テストエラー:', error);
    ui.alert('テストエラー', `設定テストに失敗しました:\n${error.message}`, ui.ButtonSet.OK);
  }
}

/**
 * 手動実行用：即座にチェック実行
 */
function manualCheck() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    console.log('手動チェックを開始します...');
    WatchNewFile();
    
    ui.alert('手動チェック完了', '手動チェックが完了しました。結果はDiscordとログで確認してください。', ui.ButtonSet.OK);
    
  } catch (error) {
    console.error('手動チェックエラー:', error);
    ui.alert('チェックエラー', `手動チェックに失敗しました:\n${error.message}`, ui.ButtonSet.OK);
  }
}
/**
 * トリガーを設定
 */
function setupTrigger() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    // 既存のトリガーを確認
    const triggers = ScriptApp.getProjectTriggers();
    const existingTrigger = triggers.find(trigger => 
      trigger.getHandlerFunction() === 'WatchNewFile'
    );
    
    if (existingTrigger) {
      const result = ui.alert(
        'トリガー設定',
        'WatchNewFile関数のトリガーが既に設定されています。\n再設定しますか？',
        ui.ButtonSet.YES_NO
      );
      
      if (result === ui.Button.YES) {
        ScriptApp.deleteTrigger(existingTrigger);
      } else {
        return;
      }
    }
    
    // 新しいトリガーを作成（5分間隔）
    ScriptApp.newTrigger('WatchNewFile')
      .timeBased()
      .everyMinutes(5)
      .create();
    
    ui.alert('トリガー設定完了', 
      'WatchNewFile関数が5分間隔で自動実行されるよう設定しました。\n\n' +
      '※初回実行まで最大5分お待ちください。',
      ui.ButtonSet.OK);
    
  } catch (error) {
    console.error('トリガー設定エラー:', error);
    ui.alert('トリガー設定エラー', `トリガーの設定に失敗しました:\n${error.message}`, ui.ButtonSet.OK);
  }
}

/**
 * トリガーを削除
 */
function deleteTrigger() {
  const ui = SpreadsheetApp.getUi();
  
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const watchTriggers = triggers.filter(trigger => 
      trigger.getHandlerFunction() === 'WatchNewFile'
    );
    
    if (watchTriggers.length === 0) {
      ui.alert('トリガー削除', 'WatchNewFile関数のトリガーは設定されていません。', ui.ButtonSet.OK);
      return;
    }
    
    const result = ui.alert(
      'トリガー削除確認',
      `WatchNewFile関数のトリガーを削除しますか？\n（${watchTriggers.length}個のトリガー）`,
      ui.ButtonSet.YES_NO
    );
    
    if (result === ui.Button.YES) {
      watchTriggers.forEach(trigger => {
        ScriptApp.deleteTrigger(trigger);
      });
      
      ui.alert('トリガー削除完了', 'WatchNewFile関数のトリガーを削除しました。', ui.ButtonSet.OK);
    }
    
  } catch (error) {
    console.error('トリガー削除エラー:', error);
    ui.alert('トリガー削除エラー', `トリガーの削除に失敗しました:\n${error.message}`, ui.ButtonSet.OK);
  }
}
