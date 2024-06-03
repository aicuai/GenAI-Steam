function createImages() {
  var prompt = 'Lighthouse on a cliff overlooking the ocean';
  var negativePrompt = '';
  var aspectRatio = '16:9';
  var outputFormat = 'webp';
  var imgNum = 1; // 生成する画像の枚数
  var stabilityApiKey = 'sk-YnoCouenToc1Etn40UZiTj1kbvujYeJ3e3aQ33cyOFjYuAvE';
  var allImgNum = imgNum * 17; // 合計出力枚数
  var stylePresets = [
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

  // API呼び出し関数
  function callApi(stylePreset, cycleNum) {
    var url = 'https://api.stability.ai/v2beta/stable-image/generate/core';
    var options = {
      'method': 'post',
      'headers': {
        'authorization': 'Bearer ' + stabilityApiKey,
        'accept': 'image/*'
      },
      'payload': {
        'prompt': prompt,
        'negative_prompt': negativePrompt,
        'style_preset': stylePreset,
        'aspect_ratio': aspectRatio,
        'output_format': outputFormat
      }
    };

    var response = UrlFetchApp.fetch(url, options);
    var blob = response.getBlob();
    var fileName = prompt + '_' + stylePreset + '_' + cycleNum + '.' + outputFormat;
    DriveApp.createFile(blob).setName(fileName);
  }

  // 画像生成プロセス
  for (var n = 1; n <= imgNum; n++) {
    for (var i = 0; i < stylePresets.length; i++) {
      var stylePreset = stylePresets[i];
      Logger.log(stylePreset + 'スタイル で生成中...');
      callApi(stylePreset, n);
    }
    Logger.log(n + 'サイクル 生成完了');
  }

  Logger.log('生成が完了しました。Google Driveのルートフォルダを確認してください。');
}
