// Stable Diffusion 3 を Google Apps Scriptで利用する｜AICU media @AICUai #note https://note.com/aicu/n/ne2fe8a0073b0

const STABILITY_KEY = PropertiesService.getScriptProperties().getProperty("STABILITY_KEY");

function saveImageToDrive() {
  var url = "https://api.stability.ai/v2beta/stable-image/generate/sd3";
  var token = "Bearer "+ STABILITY_KEY; // 本番環境ではセキュリティを考慮して保管してください
  var boundary = "-------314159265358979323846";
  var data = "--" + boundary + "\r\n" +
             "Content-Disposition: form-data; name=\"prompt\"\r\n\r\n" +
             "shibuya crossing, animetic, with graffiti 'AICU media'\r\n" +
             "--" + boundary + "\r\n" +
             "Content-Disposition: form-data; name=\"output_format\"\r\n\r\n" +
             "png\r\n" +
             "--" + boundary + "\r\n" +
             "Content-Disposition: form-data; name=\"aspect_ratio\"\r\n\r\n" +
             "16:9\r\n" +
             "--" + boundary + "--";

  var options = {
    "method": "post",
    "contentType": "multipart/form-data; boundary=" + boundary,
    "headers": {
      "Authorization": token,
      "Accept": "image/*"
    },
    "payload": data,
    "muteHttpExceptions": true
  };

  var response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() == 200) {
    var blob = response.getBlob();
    blob.setName("SD3.png");
    var file = DriveApp.createFile(blob);
    Logger.log('Image saved to Drive with ID: ' + file.getId());
  } else {
    Logger.log('Failed to fetch image: ' + response.getResponseCode());
  }
}
