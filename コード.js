/**
 * Classroom Assignment Status Aggregator
 * Version: 2025-07-07 (Merged)
 *
 * 機能概要
 * ────────────────────────────────────────────────────────────────────
 * [設定: Settings]
 * • `getAssignments`初回実行時に `setting` シートを自動生成します。
 * • このシートで、課題評価 (Flag) の計算モードを選択できます。
 * - 3段階評価 (デフォルト), 提出チェック, 3段階カスタム, 割合, 素点
 *
 * [課題取得: Get Assignments]
 * 1. `Get All Classes`: アクティブな授業を `classes` シートへ一覧表示します。(クラス名でソート)
 * 2. `Get Assignments`: `classes`シートでチェックを入れた授業の課題と提出状況を `assignment` シートへ展開します。
 * • 処理中にどの課題を取得しているか、進捗がポップアップで表示されるようになりました。
 * • (初回実行時): `setting`シートの作成のみ行い、処理を中断します。
 * • (2回目以降): 処理開始前に、適用される評価モードの確認ダイアログを表示します。
 * • `setting`シートのモードに基づき、Flag列を計算・出力します。
 * • Flag列のヘッダーに適用されたモード名が明記されます (例: `Flag (3段階カスタム: 100/60)`)。
 * • スコアに応じてセルの背景色を変更します (満点/高評価:青, 部分点/中評価:緑, 0点/未提出/低評価:赤)。
 *
 * [スコア集計: Aggregate Scores]
 * 3. `Aggregate Scores`: UIダイアログを起動し、集計対象のクラス・課題・出力先シートを選択できます。
 * • Full Score, Score Rate, Missing Rate を生徒ごとに出題された課題のみで計算するよう修正。
 * • 集計対象クラスは`assignment`シートから取得し、デフォルトで全選択されます。
 * • ダイアログに「最新の情報をClassroomから再取得する」チェックボックスを追加。
 *
 * [ヘルプ: HELP]
 * • メニューからHELPを選択すると、各機能の使い方を解説したダイアログが表示されます。
 *
 * 前提：
 * このスクリプトを実行するには、Google Cloud Platformプロジェクトで
 * Advanced Google Services の "Google Classroom API" を有効にする必要があります。
 */

/* ------------------------------------------------------------------ */
/* カスタムメニュー (スプレッドシートを開いたときに表示)
/* ------------------------------------------------------------------ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Classroom Tools')
    .addItem('1. Get All Classes', 'getAllClasses')
    .addItem('2. Get Assignments', 'getAssignments')
    .addSeparator()
    .addItem('3. Aggregate Scores', 'showAggregateDialog')
    .addSeparator()
    .addItem('HELP', 'showHelpDialog') // ★ HELPメニューを追加
    .addToUi();
}

/* ------------------------------------------------------------------ */
/* 共通ユーティリティ関数
/* ------------------------------------------------------------------ */
function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (sh) {
    sh.clear();
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clear({
      contentsOnly: false, formatOnly: false, noteOnly: false, validationsOnly: false
    });
    sh.setFrozenRows(0);
  } else {
    sh = ss.insertSheet(name);
  }
  
  if (headers?.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function addCheckboxes_(range) {
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  range.setDataValidation(rule);
}

/* ------------------------------------------------------------------ */
/* 0. 設定シートの管理
/* ------------------------------------------------------------------ */
function ensureSettingSheet_() {
  const ss = SpreadsheetApp.getActive();
  const name = 'setting';
  let sh = ss.getSheetByName(name);
  if (sh) return false;

  sh = ss.insertSheet(name, 0);
  sh.getRange('A1').setValue('評価モード設定').setFontWeight('bold');
  const settings = [
    ['Select', 'Mode Name', 'Description', 'Parameter 1', 'Parameter 2'],
    [true, '3段階評価モード', '未提出:0, 部分点:1, 満点:2 で評価します。(デフォルト)', '', ''],
    [false, '提出チェックモード', '未提出/0点:0, 提出済み:1 で評価します。', '', ''],
    [false, '3段階カスタムモード', '右記の点数で評価します (未提出:0, 部分点:1, 満点:2)。', '満点 >=', '部分点 >='],
    [false, '割合モード', '満点に対する得点率で評価します (0.0 ~ 1.0)。', '', ''],
    [false, '素点モード', '課題の得点をそのまま評価値として使用します。', '', '']
  ];
  sh.getRange(2, 1, settings.length, settings[0].length).setValues(settings);
  sh.getRange('D5:E5').setValues([['100', '60']]);
  sh.getRange(3, 1, settings.length - 1, 1).insertCheckboxes();
  sh.setFrozenRows(2);
  sh.autoResizeColumns(1, 5);
  
  return true;
}

function getFlaggingConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('setting');
  if (!sh) {
    return { mode: '3-Step', name: '3段階評価モード', params: null, header: 'Flag (3段階評価)' };
  }
  const data = sh.getRange('A3:E' + sh.getLastRow()).getValues();
  const selectedRow = data.find(row => row[0] === true);

  if (!selectedRow) {
    return { mode: '3-Step', name: '3段階評価モード', params: null, header: 'Flag (3段階評価)' };
  }

  const modeName = selectedRow[1];
  let config = { mode: '', name: modeName, params: null, header: '' };

  switch (modeName) {
    case '提出チェックモード':
      config.mode = 'Binary';
      config.header = 'Flag (提出チェック)';
      break;
    case '3段階カスタムモード':
      config.mode = 'Custom';
      const full = parseFloat(selectedRow[3]) || 0;
      const partial = parseFloat(selectedRow[4]) || 0;
      config.params = { full, partial };
      config.header = `Flag (3段階カスタム: ${full}/${partial})`;
      break;
    case '割合モード':
      config.mode = 'Percentage';
      config.header = 'Flag (割合)';
      break;
    case '素点モード':
      config.mode = 'RawScore';
      config.header = 'Flag (素点)';
      break;
    default:
      config.mode = '3-Step';
      config.header = 'Flag (3段階評価)';
      break;
  }
  return config;
}

/* ------------------------------------------------------------------ */
/* 1. クラス一覧の取得
/* ------------------------------------------------------------------ */
function getAllClasses() {
  const sh = ensureSheet_('classes', [
    'Select', 'Course name', 'Section', 'Room', 'Enrollment code',
    'Course state', 'Course ID', 'Owner ID', 'Creation time'
  ]);
  let token, courses = [];
  try {
    do {
      const res = Classroom.Courses.list({ teacherId: 'me', courseStates: 'ACTIVE', pageSize: 500, pageToken: token });
      if (res.courses?.length) courses = courses.concat(res.courses);
      token = res.nextPageToken;
    } while (token);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Classroom APIの実行に失敗しました。\n\nエラー: ' + e.message);
    return;
  }
  if (!courses.length) {
    SpreadsheetApp.getUi().alert('アクティブなクラスが見つかりませんでした。');
    return;
  }

  courses.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const rows = courses.map(c => [false, c.name || '', c.section || '', c.room || '', c.enrollmentCode || '', c.courseState || '', c.id, c.ownerId, c.creationTime]);
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  addCheckboxes_(sh.getRange(2, 1, rows.length, 1));
  SpreadsheetApp.getActive().toast(`${courses.length}件のクラスを取得しました。`, '完了', 5);
}

/* ------------------------------------------------------------------ */
/* 2. 課題と提出状況の取得 (UIラッパーとコアロジック)
/* ------------------------------------------------------------------ */
function getAssignments() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();

  if (ensureSettingSheet_()) {
    ui.alert('評価モードを設定するための `setting` シートを初回作成しました。\n\n設定内容を確認・変更してから、再度この「2. Get Assignments」を実行してください。');
    return;
  }

  const classSheet = ss.getSheetByName('classes');
  if (!classSheet) return ui.alert('先に "1. Get All Classes" を実行してください。');

  if (ss.getSheetByName('assignment')) {
    if (ui.alert('`assignment`シートを上書きします。続行しますか？', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
       ss.toast('処理をキャンセルしました。');
       return;
    }
  }
  
  const config = getFlaggingConfig_();
  const confirmMessage = `評価モード「${config.name}」で処理を開始します。\n\nよろしいですか？`;
  if (ui.alert(confirmMessage, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
    ss.toast('処理をキャンセルしました。');
    return;
  }

  const result = getAssignmentsCore_();
  if (result.success) {
    ss.toast(`${result.count}件の提出データを取得しました。`, '完了', 5);
  } else {
    ui.alert(`課題データの取得中にエラーが発生しました。\n\nエラー: ${result.error}`);
  }
}

function getAssignmentsCore_() {
  const ss = SpreadsheetApp.getActive();
  const classSheet = ss.getSheetByName('classes');
  if (!classSheet) return { success: false, error: '`classes`シートが見つかりません。' };

  const selected = classSheet.getDataRange().getValues().slice(1)
    .filter(r => r[0] === true).map(r => ({ id: r[6].toString(), name: r[1] }));
  if (!selected.length) return { success: false, error: '`classes`シートで処理対象のクラスにチェックを入れてください。' };
  
  const config = getFlaggingConfig_();

  const headers = [
    'ID', 'Email', 'Student name', 'Course name', 'Assignment title',
    'Submission state', 'Score', 'MaxPoints', config.header,
    'Course ID', 'CourseWork ID', 'Submission ID', 'Student ID',
    'Topic name', 'Topic ID'
  ];
  const assignSheet = ensureSheet_('assignment', headers);

  const COLOR_HIGH = '#EAF3FD', COLOR_MID = '#E7F8E9', COLOR_LOW = '#FDEAEA';
  let rowId = 1, buffer = [], styleMap = {};

  try {
    selected.forEach(({ id: courseId, name: courseName }) => {
      const students = listStudents_(courseId);
      const topicMap = buildTopicMap_(courseId);
      let cwTok;
      do {
        const cwRes = Classroom.Courses.CourseWork.list(courseId, { pageSize: 100, pageToken: cwTok });
        cwRes.courseWork?.forEach(cw => {
          if (cw.workType !== 'ASSIGNMENT') return;
          const max = cw.maxPoints ?? '';
          
          ss.toast(`📥 ${courseName} → ${cw.title}`, '課題取得中...', 10);

          let subTok;
          do {
            const subRes = Classroom.Courses.CourseWork.StudentSubmissions.list(courseId, cw.id, { pageSize: 100, pageToken: subTok });
            subRes.studentSubmissions?.forEach(sub => {
              const profile = students[sub.userId] || { email: '', name: '' };
              const scoreVal = sub.assignedGrade ?? '';
              let flag = '', color = '';
              const isUnsubmitted = scoreVal === '' || scoreVal === 0;

              switch (config.mode) {
                case 'Binary': flag = isUnsubmitted ? 0 : 1; color = isUnsubmitted ? COLOR_LOW : COLOR_HIGH; break;
                case 'Custom':
                  if (isUnsubmitted) { flag = 0; color = COLOR_LOW; } 
                  else if (scoreVal >= config.params.full) { flag = 2; color = COLOR_HIGH; } 
                  else if (scoreVal >= config.params.partial) { flag = 1; color = COLOR_MID; } 
                  else { flag = 0; color = COLOR_LOW; }
                  break;
                case 'Percentage':
                  flag = (max > 0 && !isUnsubmitted) ? (scoreVal / max) : 0;
                  if (flag === 1) color = COLOR_HIGH; else if (flag > 0) color = COLOR_MID; else color = COLOR_LOW;
                  break;
                case 'RawScore':
                  flag = isUnsubmitted ? 0 : scoreVal;
                  if (max !== '' && scoreVal === max) color = COLOR_HIGH; else if (!isUnsubmitted) color = COLOR_MID; else color = COLOR_LOW;
                  break;
                default:
                  if (isUnsubmitted) { flag = 0; color = COLOR_LOW; } 
                  else if (max !== '' && scoreVal === max) { flag = 2; color = COLOR_HIGH; } 
                  else { flag = 1; color = COLOR_MID; }
                  break;
              }
              buffer.push([rowId, profile.email, profile.name, courseName, cw.title, sub.state, scoreVal, max, flag, courseId, cw.id, sub.id, sub.userId, topicMap[cw.topicId] || '', cw.topicId || '']);
              styleMap[rowId + 1] = { color };
              rowId++;
            });
            subTok = subRes.nextPageToken;
          } while (subTok);
        });
        cwTok = cwRes.nextPageToken;
      } while (cwTok);
    });
  } catch (e) {
    return { success: false, error: e.message };
  }

  if (!buffer.length) return { success: false, error: '選択されたクラスに課題データが見つかりませんでした。' };
  
  assignSheet.getRange(2, 1, buffer.length, headers.length).setValues(buffer);
  const scoreCol = headers.indexOf('Score') + 1;
  Object.keys(styleMap).forEach(r => assignSheet.getRange(Number(r), scoreCol).setBackground(styleMap[r].color));
  
  return { success: true, count: buffer.length };
}

/* ------------------------------------------------------------------ */
/* 3-A. 集計設定ダイアログの表示
/* ------------------------------------------------------------------ */
function showAggregateDialog() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  let classNames = [], assignments = [], flagHeader = '（`assignment`シートがありません）';

  const asSheet = ss.getSheetByName('assignment');
  if (asSheet) {
    const asClassVals = asSheet.getRange(2, 4, asSheet.getLastRow() - 1, 1).getValues();
    classNames = [...new Set(asClassVals.flat().filter(String))].sort();

    const asVals = asSheet.getRange(2, 5, asSheet.getLastRow() - 1, 1).getValues();
    assignments = [...new Set(asVals.flat().filter(String))].sort();
    const asHeaders = asSheet.getRange(1, 1, 1, asSheet.getLastColumn()).getValues()[0];
    flagHeader = asHeaders.find(h => h.startsWith('Flag')) || 'Flag (不明)';
  }

  if (!classNames.length || !assignments.length) {
    return ui.alert('`assignment`シートに集計対象のデータがありません。');
  }

  const summarySheets = ss.getSheets().map(s => s.getName()).filter(n => /_summary$/.test(n)).sort();

  const html = `<!DOCTYPE html><html><head><base target="_top"><style>
    body{font-family:sans-serif;margin:20px; font-size:14px; line-height:1.6;}
    label{display:block; margin-bottom:4px; font-weight:bold;}
    select,input[type="text"]{width:100%;box-sizing:border-box;margin-bottom:16px;padding:8px;border:1px solid #ccc;border-radius:4px;}
    button{padding:10px 20px;border:none;border-radius:4px;background-color:#4285f4;color:white;cursor:pointer;font-size:14px;}
    button:hover{background-color:#357ae8;}
    .info{background-color:#f0f0f0; padding:10px; border-radius:4px; margin-bottom:16px;}
    .checkbox-container{border:1px solid #ccc;border-radius:4px;padding:8px;height:150px;overflow-y:auto;margin-bottom:16px;}
    .checkbox-container label{display:block;font-weight:normal;margin-bottom:4px;}
    .checkbox-container label:hover{background-color:#f5f5f5;}
    .option-checkbox{margin-top:20px;font-weight:normal;display:flex;align-items:center;}
    .option-checkbox input{width:auto;margin-right:8px;margin-bottom:0;}
  </style></head><body>
    <div class="info">現在の集計ルール: <strong>${flagHeader}</strong></div>
    <label for="classContainer">集計対象クラス</label>
    <div id="classContainer" class="checkbox-container"></div>
    <label for="asgContainer">集計対象課題</label>
    <div id="asgContainer" class="checkbox-container"></div>
    <label for="sheetSel">出力先サマリーシート</label>
    <select id="sheetSel"></select>
    <input type="text" id="newName" placeholder="新規シート名 (例: 1学期末)" style="display:none;"/>
    <label class="option-checkbox"><input type="checkbox" id="refreshData">最新の情報をClassroomから再取得する</label>
    <button onclick="submitSel()" style="margin-top:16px;">集計開始</button>
    <script>
      const CLASS_OPTS=${JSON.stringify(classNames)};
      const ASSIGN_OPTS=${JSON.stringify(assignments)};
      const SUM_SHEETS=${JSON.stringify(summarySheets)};
      document.getElementById('classContainer').innerHTML = CLASS_OPTS.map(v => '<label><input type="checkbox" name="classes" value="'+v.replace(/"/g, '&quot;')+'" checked> '+v+'</label>').join('');
      document.getElementById('asgContainer').innerHTML = ASSIGN_OPTS.map(v => '<label><input type="checkbox" name="assignments" value="'+v.replace(/"/g, '&quot;')+'"> '+v+'</label>').join('');
      const sheetSel=document.getElementById('sheetSel'), newName=document.getElementById('newName');
      sheetSel.innerHTML='<option value="__new__">** 新規作成 **</option>'+SUM_SHEETS.map(n=>'<option value="'+n+'">'+n+'</option>').join('');
      sheetSel.onchange = () => { newName.style.display = sheetSel.value === '__new__' ? 'block' : 'none'; };
      if (sheetSel.value === '__new__') newName.style.display = 'block';
      function submitSel(){
        const cls = [...document.querySelectorAll('input[name="classes"]:checked')].map(cb => cb.value);
        const asg = [...document.querySelectorAll('input[name="assignments"]:checked')].map(cb => cb.value);
        const refresh = document.getElementById('refreshData').checked;
        if(cls.length===0||asg.length===0){alert('クラスと課題を1つ以上選択してください。');return;}
        if(sheetSel.value==='__new__' && !newName.value.trim()){alert('シート名を入力してください。');return;}
        google.script.run.withSuccessHandler(()=>google.script.host.close())
          .processAggregateSelection({classes:cls,assignments:asg,targetSheet:sheetSel.value,newName:newName.value.trim(), refreshData: refresh});
      }
    </script>
  </body></html>`;

  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(620), '集計設定');
}

/* ------------------------------------------------------------------ */
/* 3-B. ダイアログからの入力処理
/* ------------------------------------------------------------------ */
function processAggregateSelection(sel) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();

  if (sel.refreshData) {
    ss.toast('Classroomから最新のデータを取得しています...', '更新中', 30);
    const result = getAssignmentsCore_();
    if (!result.success) {
      ui.alert(`データの更新に失敗しました。集計を中止します。\n\nエラー: ${result.error}`);
      return;
    }
    ss.toast('データの更新が完了しました。集計を開始します。', '更新完了', 5);
  }

  aggregateScores_(sel.classes, sel.assignments, sel.targetSheet, sel.newName);
}

/* ------------------------------------------------------------------ */
/* 3-C. スコア集計とシートへの出力
/* ------------------------------------------------------------------ */
function aggregateScores_(targetClasses, targetAssignments, sheetChoice, newName) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  const assignSh = ss.getSheetByName('assignment');
  if (!assignSh) return ui.alert('`assignment`シートが見つかりません。');

  const assignmentSet = [...new Set(targetAssignments)].sort();
  let summaryName = sheetChoice === '__new__' ? (newName.endsWith('_summary') ? newName : newName + '_summary') : sheetChoice;
  if (!summaryName) return ui.alert('出力先シート名が無効です。');

  if (ss.getSheetByName(summaryName)) {
    if (ui.alert(`シート「${summaryName}」を上書きしますか？`, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) {
      return ss.toast('処理をキャンセルしました。');
    }
  }

  ss.toast(`集計を開始します...`, '処理中', 10);

  const data = assignSh.getDataRange().getValues();
  const headerRow = data[0];
  const idx = headerRow.reduce((m, v, i) => (m[v] = i, m), {});
  
  const flagHeader = headerRow.find(h => h.startsWith('Flag'));
  if (!flagHeader || !(flagHeader in idx)) {
    ui.alert('エラー: `assignment`シートにFlag列が見つかりませんでした。集計を中止します。');
    return;
  }
  const flagIdx = idx[flagHeader];

  const rows = data.slice(1).filter(r =>
    targetClasses.includes(r[idx['Course name']]) &&
    assignmentSet.includes(r[idx['Assignment title']])
  );
  if (!rows.length) return ui.alert('対象データがありませんでした。');

  const maxPointsMap = new Map();
  if (flagHeader.includes('素点')) {
    rows.forEach(r => maxPointsMap.set(r[idx['Assignment title']], r[idx['MaxPoints']]));
  }

  const stuMap = {};
  rows.forEach(r => {
    const email = r[idx['Email']];
    const assignmentTitle = r[idx['Assignment title']];
    const flag = r[flagIdx];

    if (!stuMap[email]) {
      stuMap[email] = { 
        name: r[idx['Student name']], 
        cls: r[idx['Course name']], 
        email, 
        scores: {}
      };
    }
    stuMap[email].scores[assignmentTitle] = flag;
  });

  const stuArr = Object.values(stuMap).sort((a, b) => a.cls.localeCompare(b.cls) || a.email.localeCompare(b.email));
  const headers = ['Student name', 'Class', 'Email', 'Total Score', 'Full Score', 'Score Rate', 'Missing Count', 'Missing Rate', ...assignmentSet];
  const out = stuArr.map(stu => {
    let totalScore = 0;
    let studentFullScore = 0;
    let missingCount = 0;
    let assignedCount = 0;

    assignmentSet.forEach(asgTitle => {
      const score = stu.scores[asgTitle];
      
      if (score !== undefined && score !== null) {
        assignedCount++;

        if (flagHeader.includes('素点')) {
          studentFullScore += (maxPointsMap.get(asgTitle) || 0);
        } else if (flagHeader.includes('3段階')) {
          studentFullScore += 2;
        } else {
          studentFullScore += 1;
        }

        const numericScore = parseFloat(score);
        if (!isNaN(numericScore)) {
          totalScore += numericScore;
        }
        
        if (score === 0 || score === '') {
          missingCount++;
        }
      }
    });
    
    const individualScores = assignmentSet.map(a => stu.scores[a] ?? '.');

    return [
      stu.name, stu.cls, stu.email, 
      totalScore, 
      studentFullScore,
      studentFullScore > 0 ? totalScore / studentFullScore : 0,
      missingCount,
      assignedCount > 0 ? missingCount / assignedCount : 0,
      ...individualScores
    ];
  });

  const sumSheet = ensureSheet_(summaryName, headers);
  sumSheet.getRange('A1').setValue(`集計ルール: ${flagHeader}`);
  sumSheet.getRange('A1').setFontStyle('italic').setFontColor('#666');

  if (out.length) {
    const range = sumSheet.getRange(2, 1, out.length, headers.length);
    range.setValues(out);
    sumSheet.getRange(2, 6, out.length, 1).setNumberFormat('0.0%');
    sumSheet.getRange(2, 8, out.length, 1).setNumberFormat('0.0%');
    if (flagHeader.includes('割合')) {
      sumSheet.getRange(2, headers.indexOf(assignmentSet[0]) + 1, out.length, assignmentSet.length).setNumberFormat('0.0%');
    }
    sumSheet.autoResizeColumns(1, headers.length);
  }
  ss.toast(`「${summaryName}」への集計が完了しました。`, '完了', 10);
  ss.setActiveSheet(sumSheet);
}

/* ------------------------------------------------------------------ */
/* 4. ヘルプダイアログの表示 (★新規追加)
/* ------------------------------------------------------------------ */
function showHelpDialog() {
  const htmlContent = `
  <!DOCTYPE html>
  <html>
    <head>
      <base target="_top">
      <style>
        body { font-family: sans-serif; margin: 20px; line-height: 1.6; color: #333; }
        h2 { color: #4285f4; border-bottom: 2px solid #4285f4; padding-bottom: 5px; }
        h3 { color: #333; border-left: 4px solid #ccc; padding-left: 10px; }
        p, li { font-size: 14px; }
        code { background-color: #f0f0f0; padding: 2px 5px; border-radius: 4px; font-family: monospace; }
        .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; text-align: center; font-size: 12px; }
      </style>
    </head>
    <body>
      <h2>Classroom Aggregator ヘルプ</h2>

      <h3>1. Get All Classes</h3>
      <p>現在あなたが教師として参加している、アクティブなGoogle Classroomのクラスを一覧で取得し、<code>classes</code>シートに書き出します。</p>
      <ul>
        <li>この機能で取得したクラスの中から、次のステップで課題を取得したいクラスを選択します。</li>
      </ul>

      <h3>2. Get Assignments</h3>
      <p><code>classes</code>シートでチェックを入れたクラスの全課題と、全生徒の提出状況を取得し、<code>assignment</code>シートに展開します。</p>
      <ul>
        <li><strong>初回実行時:</strong> <code>setting</code>という設定用シートが自動で作成されます。このシートで課題の評価方法（Flagの計算方法）をカスタマイズできます。</li>
        <li><strong>進捗表示:</strong> 処理中は、どのクラスのどの課題を処理しているかが右下にポップアップで表示されます。</li>
        <li><strong>評価モード:</strong> <code>setting</code>シートで選択したルールに基づき、<code>Flag</code>列が計算されます。</li>
      </ul>

      <h3>3. Aggregate Scores</h3>
      <p><code>assignment</code>シートのデータを元に、生徒ごとのスコアを集計し、新しい<code>_summary</code>シートを作成します。</p>
      <ul>
        <li><strong>集計対象の選択:</strong> ダイアログが開き、集計したいクラスや課題を自由に選択できます。</li>
        <li><strong>データ更新:</strong> 「最新の情報をClassroomから再取得する」にチェックを入れると、集計前に最新の提出状況を再取得するため、常に正確なデータで集計できます。</li>
        <li><strong>柔軟な集計:</strong> 生徒ごとに出題された課題のみを対象として、満点や得点率が正しく計算されます。</li>
      </ul>
      
      <div class="footer">
        <p>このツールの最新情報や詳細な使い方はGitHub Pagesで公開しています。<br>
        <a href="https://phys-ken.github.io/classroom_assignment_aggregator/" target="_blank">https://phys-ken.github.io/classroom_assignment_aggregator/</a></p>
        <p>ご不明な点や改善要望がありましたら、下記までご連絡ください。<br>
        <a href="https://note.com/phys_ken" target="_blank">お問い合わせ (開発者: phys-ken)</a></p>
      </div>
    </body>
  </html>
  `;
  const htmlOutput = HtmlService.createHtmlOutput(htmlContent)
    .setWidth(600)
    .setHeight(550);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'ヘルプ');
}


/* ------------------------------------------------------------------ */
/* ヘルパー関数 (Classroom API 関連)
/* ------------------------------------------------------------------ */
function buildTopicMap_(courseId) {
  const map = {}; let tok;
  try {
    do {
      const res = Classroom.Courses.Topics.list(courseId, { pageSize: 100, pageToken: tok });
      res.topic?.forEach(t => map[t.topicId] = t.name);
      tok = res.nextPageToken;
    } while (tok);
  } catch (e) { console.warn(`Could not fetch topics for course ${courseId}: ${e.message}`); }
  return map;
}

function listStudents_(courseId) {
  const map = {}; let tok;
  try {
    do {
      const res = Classroom.Courses.Students.list(courseId, { pageSize: 100, pageToken: tok });
      res.students?.forEach(s => { map[s.userId] = { email: s.profile.emailAddress || '', name: s.profile.name.fullName || '' }; });
      tok = res.nextPageToken;
    } while (tok);
  } catch (e) { console.warn(`Could not fetch students for course ${courseId}: ${e.message}`); }
  return map;
}
