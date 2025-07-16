function createSingleRunDetails(singleNightRun) {
  // TODO support multiple runs a day
  // TODO include version
  console.log(singleNightRun);
  clearAllSingleRunDetails();
  const insightsGrid = document.getElementById('insights-grid');
  insightsGrid.appendChild(createCard('Model', singleNightRun.model));
  insightsGrid.appendChild(createCard('Total Files', singleNightRun.totalFiles));
  if (singleNightRun.buildable !== undefined) {
    insightsGrid.appendChild(createCard('Buildable', singleNightRun.buildable ? '✅' : '❌'));
  }
  insightsGrid.appendChild(
    createCard('Average Competency', singleNightRun.averageCompetency.toFixed(2))
  );
  insightsGrid.appendChild(
    createCard('Average Effectiveness', singleNightRun.averageEffectiveness.toFixed(2))
  );
  insightsGrid.appendChild(
    createCard('Average Specificity', singleNightRun.averageSpecificity.toFixed(2))
  );
  createFileEvaluationsTable(singleNightRun.fileEvaluationResults);
  createErrorsList(singleNightRun.errors);
  const container = document.getElementById('single-run-overview');
  container.style.display = 'block';
}

function createFileEvaluationsTable(fileEvaluations) {
  const tbody = document.getElementById('file-evaluations-table-body');
  tbody.innerHTML = '';
  fileEvaluations.forEach((fileEvaluation) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fileEvaluation.file}</td>
      <td>${fileEvaluation.competency}</td>
      <td>${fileEvaluation.effectiveness}</td>
      <td>${fileEvaluation.specificity}</td>
      <td>${fileEvaluation.averageScore.toFixed(2)}</td>
      <td>${fileEvaluation.validCode ? '✅' : '❌'}</td>
      <td>${fileEvaluation.unnecessaryChanges ? '⚠️' : 'No'}</td>
    `;
    const btn = document.createElement('button');
    const td = document.createElement('td');
    btn.innerText = '👁️';
    btn.onclick = () =>
      Swal.fire({
        title: 'Evaluation Detailed Notes',
        text: fileEvaluation.detailedNotes,
        draggable: true,
      });
    td.appendChild(btn);
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

function createErrorsList(errors) {
  if (!errors || !errors.length) {
    return;
  }
  const list = document.getElementById('file-evaluations-errors-list');
  list.innerHTML = '';
  errors.forEach((error) => {
    const li = document.createElement('li');
    li.innerText = error;
    list.appendChild(li);
  });
}

function createSingleRunsSelectors(singleRuns) {
  const singleRunsContainer = document.getElementById('single-runs-selectors-container');
  const singleRunsList = document.getElementById('single-runs-selectors-list');
  singleRuns.forEach((run) => {
    const li = document.createElement('li');
    li.innerText = `${new Date(run.date).toLocaleTimeString()} | ${run.model}`;
    li.onclick = () => createSingleRunDetails(run);
    singleRunsList.appendChild(li);
  });

  singleRunsContainer.style.display = 'block';
}

function createCard(title, value) {
  const container = document.createElement('div');
  const span = document.createElement('span');
  span.innerText = title;
  container.appendChild(span);
  const h2 = document.createElement('h2');
  h2.innerText = value;
  container.appendChild(h2);
  return container;
}

function clearAllSingleRunDetails() {
  const insightsGrid = document.getElementById('insights-grid');
  const tbody = document.getElementById('file-evaluations-table-body');
  const list = document.getElementById('file-evaluations-errors-list');
  insightsGrid.innerHTML = '';
  tbody.innerHTML = '';
  list.innerHTML = '';
}
