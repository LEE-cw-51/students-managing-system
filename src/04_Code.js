/**
 * Web app entry. UI talks only to the public API in 03_Api.js.
 */
function doGet() {
  try {
    assertAllowed_();
  } catch (e) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;color:#7a1f1f;">접근 권한이 없습니다.</div>'
    ).setTitle('수학의 힘');
  }
  var output = HtmlService.createTemplateFromFile('Index').evaluate();
  output.setTitle('수학의 힘 · 학습관리');
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  output.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return output;
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
