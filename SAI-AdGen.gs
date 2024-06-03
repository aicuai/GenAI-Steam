// AICU-AdGenerator SAI-AdGen.gs https://j.aicu.ai/SAIAD
// 2024/6/22 Coded by Akihiko SHIRAI aki@aicu.ai 

const defaultPrompt = 'urban tokyo bayfront skyline residences ad luxury super rich visual';
const stylePresets = [
  '3d-model',
  'analog-film',
  'anime',
  'cinematic',
  'comic-book',
  'digital-art',
  'enhance',
  'fantasy-art',
  'isometric',
  'line-art',
  'low-poly',
  'modeling-compound',
  'neon-punk',
  'origami',
  'photographic',
  'pixel-art',
  'tile-texture'
];

function onOpen() {
  var ui = SlidesApp.getUi();
  ui.createMenu('AI Image Generator')
    .addItem('Set API key', 'setAPIkey')
    .addItem('Add Slides by all styles', 'addSlidesByAllStyles')
    .addItem('Generate Images', 'generateImages')
    .addItem('Save All Slides', 'saveAllSlides')
    .addToUi();
  
  var scriptProperties = PropertiesService.getScriptProperties();
  var stabilityApiKey = scriptProperties.getProperty('STABILITY_API_KEY');
  
  if (!stabilityApiKey) {
    setAPIkey();
  }
}

function setAPIkey() {
  var ui = SlidesApp.getUi();
  var response = ui.prompt(
    '[S.] Stability AI Platform API Key Required\n',
    'このツールでは、画像を生成するために Stability AI プラットフォームの APIキー が必要です。\n' +
    'お持ちでない場合は、https://platform.stability.ai/account/keys でAPIキーを取得してください。\n' +
    'This program requires a Stability.ai API key to generate images. \n' +
    'If you do not have one, please visit https://platform.stability.ai/account/keys to obtain an API key.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() == ui.Button.OK) {
    var apiKey = response.getResponseText();
    PropertiesService.getScriptProperties().setProperty('STABILITY_API_KEY', apiKey);
  } else {
    ui.alert('API key is required to use this program.');
  }
}

function getPromptsFromTitleAndSubtitle() {
  var presentation = SlidesApp.getActivePresentation();
  var slides = presentation.getSlides();
  var prompt = defaultPrompt;
  var negativePrompt = '';

  // 1ページ目のスライドのテキストボックスからテキストを取得
  if (slides.length > 0) {
    var shapes = slides[0].getShapes();
    shapes.forEach(function(shape) {
      if (shape.getShapeType() == SlidesApp.ShapeType.TEXT_BOX) {
        var text = shape.getText().asString().trim();
        if (text.startsWith("Prompt=")) {
          prompt = text.substring(7).trim();
          Logger.log("Prompt = " + prompt);
        } else if (text.startsWith("NP=")) {
          negativePrompt = text.substring(3).trim();
          Logger.log("negative = " + negativePrompt)
        }
      }
    });
  }
  return { prompt, negativePrompt };
}

function callApi(stylePreset, prompt, negativePrompt, stabilityApiKey, aspectRatio, outputFormat) {
  var boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
  var payload = Utilities.newBlob(
    "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"prompt\"\r\n\r\n" + prompt + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"negative_prompt\"\r\n\r\n" + negativePrompt + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"style_preset\"\r\n\r\n" + stylePreset + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"aspect_ratio\"\r\n\r\n" + aspectRatio + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Disposition: form-data; name=\"output_format\"\r\n\r\n" + outputFormat + "\r\n" +
    "--" + boundary + "--"
  ).getBytes();
  
  var options = {
    'method': 'post',
    'headers': {
      'Authorization': 'Bearer ' + stabilityApiKey,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Accept': 'image/*'
    },
    'payload': payload,
    'muteHttpExceptions': true
  };

  var response = UrlFetchApp.fetch('https://api.stability.ai/v2beta/stable-image/generate/core', options);
  return response.getBlob();
}

function generateImages() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var stabilityApiKey = scriptProperties.getProperty('STABILITY_API_KEY');
  
  if (!stabilityApiKey) {
    setAPIkey();
    return;
  }

  var { prompt, negativePrompt } = getPromptsFromTitleAndSubtitle();
  var aspectRatio = '16:9';
  var outputFormat = 'png'; // 画像形式をPNGに設定
  var folder = DriveApp.createFolder(SlidesApp.getActivePresentation().getName());

  for (var i = 0; i < stylePresets.length; i++) {
    var stylePreset = stylePresets[i];
    Logger.log(stylePreset + 'スタイル で生成中...');
    var blob = callApi(stylePreset, prompt, negativePrompt, stabilityApiKey, aspectRatio, outputFormat);
    var fileName = prompt + '_' + stylePreset + '_1.' + outputFormat;
    folder.createFile(blob).setName(fileName);
  }

  Logger.log('画像の生成が完了しました。フォルダを確認してください。');
  var ui = SlidesApp.getUi();
  ui.alert('画像の生成が完了しました。フォルダを確認してください。');
}

function addSlidesByAllStyles() {
  var scriptProperties = PropertiesService.getScriptProperties();
  var stabilityApiKey = scriptProperties.getProperty('STABILITY_API_KEY');
  
  if (!stabilityApiKey) {
    setAPIkey();
    return;
  }

  var aspectRatio = '16:9';
  var outputFormat = 'png'; // 画像形式をPNGに設定
  var presentation = SlidesApp.getActivePresentation();
  const slideWidth = 1920; // 固定幅
  const slideHeight = 1080; // 固定高さ

  for (var i = 0; i < stylePresets.length; i++) {
    var stylePreset = stylePresets[i];
    var { prompt, negativePrompt } = getPromptsFromTitleAndSubtitle();
    Logger.log(stylePreset + 'スタイル で生成中...' + prompt + " [negative]" + negativePrompt);
    var blob = callApi(stylePreset, prompt, negativePrompt, stabilityApiKey, aspectRatio, outputFormat);
    
    // スライドに画像を背景として追加
    var slide = presentation.appendSlide(SlidesApp.PredefinedLayout.BLANK);
//    slide.getBackground().setPictureFill(blob); //背景画像にしたい場合はこっち
    slide.insertImage(blob).setLeft(0).setTop(0).setWidth(slideWidth).setHeight(slideHeight); //画面最大化配置


    // スライドのタイトルとメモに使用したスタイルを挿入
    var titleShape = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, 0, 0, slideWidth, 50);
    titleShape.getText().setText(stylePreset);
    slide.getNotesPage().getSpeakerNotesShape().getText().setText('Style used: ' + stylePreset + "\nPrompt=" + prompt + "\nNP=" + negativePrompt);

    //テキストオブジェクトをコピー
    locateTextObjects(slide);
  }
  Logger.log('スライドの作成が完了しました。');
}

// スライドに背景画像を追加した後、第1ページの「Prompt=」や「NP=」、「https://」で始まらないテキストオブジェクトをコピーします。
function locateTextObjects(slide) {
  var firstSlide = SlidesApp.getActivePresentation().getSlides()[0];
  var shapesToCopy = firstSlide.getShapes().filter(function(shape) {
    var text = shape.getText().asString().trim();
    return !(text.startsWith("Prompt=") || text.startsWith("NP=") || text.startsWith("https://"));
  });

  shapesToCopy.forEach(function(shape) {
    slide.insertShape(shape);
  });
}

function saveAllSlides() {
  var presentation = SlidesApp.getActivePresentation();
  var slides = presentation.getSlides();
  var title = presentation.getName();
  var folder = DriveApp.createFolder(title);
  
  // プレゼンテーションをPDFとしてエクスポート
  var pdfBlob = DriveApp.getFileById(presentation.getId()).getAs('application/pdf');
  folder.createFile(pdfBlob.setName(title + '.pdf'));

  Logger.log('全てのスライドがPDFとして保存されました。フォルダ名: ' + title);
  SlidesApp.getUi().alert('全てのスライドがPDFとして保存されました。フォルダ名: ' + title);
}
