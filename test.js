/**
 * Classroom Assignment Status Aggregator - Test Suite
 *
 * このスクリプトは、本体のコード(gas-minimal-snippet)の機能をテストするためのものです。
 * Classroom APIを呼び出すことなく、ダミーデータを用いて各機能が正しく動作するかを検証します。
 *
 * 【使い方】
 * 1. このコードをGASプロジェクトの新しいスクリプトファイル（例: `tests.gs`）として追加します。
 * 2. GASエディタの上部にある関数選択メニューから `runAllTests` を選択します。
 * 3. 「実行」ボタンを押します。
 * 4. 実行後、ログ（[表示] > [ログ] or Ctrl+Enter）を開き、"TEST RESULTS" を確認します。
 */

// ==================================================================
// テストランナー
// ==================================================================
function runAllTests() {
  console.log('🧪 Classroom Aggregator Test Suiteを開始します...');
  
  cleanupTestSheets_();
  
  const results = [];
  
  results.push(test_setupDummyData());
  results.push(test_aggregateScores_3StepMode());
  results.push(test_aggregateScores_RawScoreMode());
  results.push(test_aggregateScores_BinaryMode());

  console.log('\n========== TEST RESULTS ==========');
  let failures = 0;
  results.forEach(res => {
    if (res.result === 'PASS') {
      console.log(`✅ PASS: ${res.name}`);
    } else {
      console.error(`❌ FAIL: ${res.name} - ${res.message}`);
      failures++;
    }
  });
  console.log('================================');
  if (failures === 0) {
    console.log('🎉 全てのテストが成功しました！');
  } else {
    console.error(`🚨 ${failures}件のテストが失敗しました。`);
  }
  console.log('🧪 テストスイートを終了します。');
}

function cleanupTestSheets_() {
  const ss = SpreadsheetApp.getActive();
  const sheetsToDelete = ss.getSheets().filter(sh => {
    const name = sh.getName();
    return name.startsWith('_test_') || name === 'setting' || name === 'assignment';
  });

  sheetsToDelete.forEach(sh => {
    try {
      ss.deleteSheet(sh);
    } catch (e) {
      console.log(`Cleanup note: Could not delete sheet '${sh.getName()}'. It might be already gone.`);
    }
  });
}

// ==================================================================
// テスト用のダミーデータ設定
// ==================================================================
/**
 * ★★★ 修正点 ★★★
 * 一部の課題のみ割り当てられた生徒(Saburo)を追加
 */
const BASE_DUMMY_DATA = [
  // email, name, course, assignment, score, maxPoints, ids...
  // Taro (3 assignments)
  ['taro@example.com', 'Taro', 'Class Alpha', 'Math HW 1', 10, 10, 'C01', 'A01', 'S01', 'U01'],
  ['taro@example.com', 'Taro', 'Class Alpha', 'Math HW 2', 7, 10, 'C01', 'A02', 'S02', 'U01'],
  ['taro@example.com', 'Taro', 'Class Alpha', 'Science Report', 0, 100, 'C01', 'A03', 'S03', 'U01'],
  // Hanako (3 assignments)
  ['hanako@example.com', 'Hanako', 'Class Alpha', 'Math HW 1', 10, 10, 'C01', 'A01', 'S04', 'U02'],
  ['hanako@example.com', 'Hanako', 'Class Alpha', 'Math HW 2', 10, 10, 'C01', 'A02', 'S05', 'U02'],
  ['hanako@example.com', 'Hanako', 'Class Alpha', 'Science Report', '', 100, 'C01', 'A03', 'S06', 'U02'],
  // Jiro (1 assignment in a different class)
  ['jiro@example.com', 'Jiro', 'Class Beta', 'Art Project', 88, '', 'C02', 'A04', 'S07', 'U03'],
  // Saburo (2 assignments only)
  ['saburo@example.com', 'Saburo', 'Class Alpha', 'Math HW 1', 5, 10, 'C01', 'A01', 'S08', 'U04'],
  ['saburo@example.com', 'Saburo', 'Class Alpha', 'Math HW 2', 8, 10, 'C01', 'A02', 'S09', 'U04'],
];

function regenerateDummyAssignmentSheet_(assignmentSheet, config) {
  const headers = [
    'ID', 'Email', 'Student name', 'Course name', 'Assignment title',
    'Submission state', 'Score', 'MaxPoints', config.header,
    'Course ID', 'CourseWork ID', 'Submission ID', 'Student ID'
  ];
  
  assignmentSheet.clear();
  assignmentSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  assignmentSheet.setFrozenRows(1);
  
  const buffer = BASE_DUMMY_DATA.map((row, index) => {
    const scoreVal = row[4];
    const max = row[5];
    let flag = '';
    const isUnsubmitted = scoreVal === '' || scoreVal === 0;

    switch (config.mode) {
      case 'Binary': flag = isUnsubmitted ? 0 : 1; break;
      case 'Custom':
        if (isUnsubmitted) flag = 0;
        else if (scoreVal >= config.params.full) flag = 2;
        else if (scoreVal >= config.params.partial) flag = 1;
        else flag = 0;
        break;
      case 'Percentage':
        flag = (max > 0 && !isUnsubmitted) ? (scoreVal / max) : 0;
        break;
      case 'RawScore':
        flag = isUnsubmitted ? 0 : scoreVal;
        break;
      default: // 3-Step
        if (isUnsubmitted) flag = 0;
        else if (max !== '' && scoreVal === max) flag = 2;
        else flag = 1;
        break;
    }
    return [index + 1, ...row.slice(0, 4), 'TURNED_IN', ...row.slice(4, 6), flag, ...row.slice(6)];
  });

  if (buffer.length > 0) {
    assignmentSheet.getRange(2, 1, buffer.length, headers.length).setValues(buffer);
  }
}

function setupDummyData_() {
  const ss = SpreadsheetApp.getActive();
  
  const settingSheet = ensureSheet_('_test_setting');
  const settings = [
    ['Select', 'Mode Name', 'Description', 'Parameter 1', 'Parameter 2'],
    [true, '3段階評価モード', '', '', ''],
    [false, '提出チェックモード', '', '', ''],
    [false, '3段階カスタムモード', '', '100', '60'],
    [false, '割合モード', '', '', ''],
    [false, '素点モード', '', '', '']
  ];
  settingSheet.getRange(1, 1, settings.length, settings[0].length).setValues(settings);
  settingSheet.getRange(2, 1, settings.length - 1, 1).insertCheckboxes();

  const assignmentSheet = ensureSheet_('_test_assignment');
  const defaultConfig = { mode: '3-Step', header: 'Flag (3段階評価)' };
  regenerateDummyAssignmentSheet_(assignmentSheet, defaultConfig);
}

// ==================================================================
// モック（偽の）オブジェクトとテストコア関数
// ==================================================================
const mockUi = {
  alert: (message, buttons) => {
    console.log(`[Mock UI Alert] ${message}`);
    return SpreadsheetApp.getUi().Button.OK;
  },
  ButtonSet: SpreadsheetApp.getUi().ButtonSet,
  Button: SpreadsheetApp.getUi().Button
};

function runAggregationTest_(modeName, targetAssignments) {
  const ss = SpreadsheetApp.getActive();
  
  const settingSheet = ss.getSheetByName('_test_setting');
  const assignmentSheet = ss.getSheetByName('_test_assignment');
  
  settingSheet.setName('setting');
  assignmentSheet.setName('assignment');

  let resultSheet = null;
  const originalUi = Object.getOwnPropertyDescriptor(SpreadsheetApp, 'getUi');

  try {
    const modeData = settingSheet.getRange('B2:B' + settingSheet.getLastRow()).getValues().flat();
    const targetRow = modeData.indexOf(modeName) + 2;
    settingSheet.getRange('A2:A' + settingSheet.getLastRow()).uncheck();
    settingSheet.getRange(targetRow, 1).check();
    
    const currentConfig = getFlaggingConfig_();
    const currentAssignmentSheet = ss.getSheetByName('assignment');
    regenerateDummyAssignmentSheet_(currentAssignmentSheet, currentConfig);

    const targetClasses = ['Class Alpha', 'Class Beta'];
    const newSheetName = `_test_summary_${modeName.replace(/\s/g, '')}`;
    Object.defineProperty(SpreadsheetApp, 'getUi', { value: () => mockUi, configurable: true });
    
    aggregateScores_(targetClasses, targetAssignments, '__new__', newSheetName);
    
    resultSheet = ss.getSheetByName(newSheetName + '_summary');

  } finally {
    Object.defineProperty(SpreadsheetApp, 'getUi', originalUi);
    
    const currentSetting = ss.getSheetByName('setting');
    if (currentSetting) currentSetting.setName('_test_setting');
    
    const currentAssignment = ss.getSheetByName('assignment');
    if (currentAssignment) currentAssignment.setName('_test_assignment');
  }
  
  return resultSheet;
}

// ==================================================================
// 個別のテストケース
// ==================================================================
function test_setupDummyData() {
  const testName = "Dummy Data Setup";
  try {
    setupDummyData_();
    const sh = SpreadsheetApp.getActive().getSheetByName('_test_assignment');
    if (sh && sh.getLastRow() > 1) {
      return { name: testName, result: 'PASS' };
    } else {
      throw new Error("ダミーのassignmentシートが正しく作成されませんでした。");
    }
  } catch (e) {
    return { name: testName, result: 'FAIL', message: e.message };
  }
}

/**
 * ★★★ 修正点 ★★★
 * Saburoのテストケースを追加し、生徒ごとのFull Scoreを検証
 */
function test_aggregateScores_3StepMode() {
  const testName = "Aggregation (3段階評価モード)";
  try {
    const assignments = ['Math HW 1', 'Math HW 2', 'Science Report'];
    const resultSheet = runAggregationTest_('3段階評価モード', assignments);
    if (!resultSheet) throw new Error("結果シートが作成されませんでした。");
    
    const data = resultSheet.getRange("A2:E" + resultSheet.getLastRow()).getValues();
    const taro = data.find(r => r[0] === 'Taro');
    const hanako = data.find(r => r[0] === 'Hanako');
    const saburo = data.find(r => r[0] === 'Saburo');
    
    const expectedTaroScore = 3;   // 2 + 1 + 0 = 3
    const expectedTaroFullScore = 6; // 3課題 * 2点
    
    const expectedHanakoScore = 4; // 2 + 2 + 0 = 4
    const expectedHanakoFullScore = 6; // 3課題 * 2点
    
    const expectedSaburoScore = 2; // 1 + 1 = 2
    const expectedSaburoFullScore = 4; // 2課題 * 2点

    if (taro[3] !== expectedTaroScore) throw new Error(`Taroのスコアが不正です。Expected: ${expectedTaroScore}, Got: ${taro[3]}`);
    if (taro[4] !== expectedTaroFullScore) throw new Error(`Taroの満点が不正です。Expected: ${expectedTaroFullScore}, Got: ${taro[4]}`);
    
    if (hanako[3] !== expectedHanakoScore) throw new Error(`Hanakoのスコアが不正です。Expected: ${expectedHanakoScore}, Got: ${hanako[3]}`);
    if (hanako[4] !== expectedHanakoFullScore) throw new Error(`Hanakoの満点が不正です。Expected: ${expectedHanakoFullScore}, Got: ${hanako[4]}`);

    if (saburo[3] !== expectedSaburoScore) throw new Error(`Saburoのスコアが不正です。Expected: ${expectedSaburoScore}, Got: ${saburo[3]}`);
    if (saburo[4] !== expectedSaburoFullScore) throw new Error(`Saburoの満点が不正です。Expected: ${expectedSaburoFullScore}, Got: ${saburo[4]}`);

    return { name: testName, result: 'PASS' };
  } catch (e) {
    return { name: testName, result: 'FAIL', message: e.message };
  }
}

function test_aggregateScores_RawScoreMode() {
  const testName = "Aggregation (素点モード)";
  try {
    const assignments = ['Math HW 1', 'Math HW 2', 'Science Report'];
    const resultSheet = runAggregationTest_('素点モード', assignments);
    if (!resultSheet) throw new Error("結果シートが作成されませんでした。");
    
    const data = resultSheet.getRange("A2:E" + resultSheet.getLastRow()).getValues();
    const taro = data.find(r => r[0] === 'Taro');
    const saburo = data.find(r => r[0] === 'Saburo');
    
    const expectedTaroScore = 17; // 10 + 7 + 0 = 17
    const expectedTaroFullScore = 120; // 10 + 10 + 100
    
    const expectedSaburoScore = 13; // 5 + 8 = 13
    const expectedSaburoFullScore = 20; // 10 + 10

    if (taro[3] !== expectedTaroScore) throw new Error(`Taroのスコアが不正です。Expected: ${expectedTaroScore}, Got: ${taro[3]}`);
    if (taro[4] !== expectedTaroFullScore) throw new Error(`Taroの満点が不正です。Expected: ${expectedTaroFullScore}, Got: ${taro[4]}`);
    
    if (saburo[3] !== expectedSaburoScore) throw new Error(`Saburoのスコアが不正です。Expected: ${expectedSaburoScore}, Got: ${saburo[3]}`);
    if (saburo[4] !== expectedSaburoFullScore) throw new Error(`Saburoの満点が不正です。Expected: ${expectedSaburoFullScore}, Got: ${saburo[4]}`);

    return { name: testName, result: 'PASS' };
  } catch (e) {
    return { name: testName, result: 'FAIL', message: e.message };
  }
}

function test_aggregateScores_BinaryMode() {
  const testName = "Aggregation (提出チェックモード)";
  try {
    const assignments = ['Math HW 1', 'Math HW 2', 'Science Report'];
    const resultSheet = runAggregationTest_('提出チェックモード', assignments);
    if (!resultSheet) throw new Error("結果シートが作成されませんでした。");
    
    const data = resultSheet.getRange("A2:E" + resultSheet.getLastRow()).getValues();
    const taro = data.find(r => r[0] === 'Taro');
    const saburo = data.find(r => r[0] === 'Saburo');
    
    const expectedTaroScore = 2;   // 1 + 1 + 0 = 2
    const expectedTaroFullScore = 3; // 3課題 * 1点
    
    const expectedSaburoScore = 2; // 1 + 1 = 2
    const expectedSaburoFullScore = 2; // 2課題 * 1点

    if (taro[3] !== expectedTaroScore) throw new Error(`Taroのスコアが不正です。Expected: ${expectedTaroScore}, Got: ${taro[3]}`);
    if (taro[4] !== expectedTaroFullScore) throw new Error(`Taroの満点が不正です。Expected: ${expectedTaroFullScore}, Got: ${taro[4]}`);

    if (saburo[3] !== expectedSaburoScore) throw new Error(`Saburoのスコアが不正です。Expected: ${expectedSaburoScore}, Got: ${saburo[3]}`);
    if (saburo[4] !== expectedSaburoFullScore) throw new Error(`Saburoの満点が不正です。Expected: ${expectedSaburoFullScore}, Got: ${saburo[4]}`);

    return { name: testName, result: 'PASS' };
  } catch (e) {
    return { name: testName, result: 'FAIL', message: e.message };
  }
}
