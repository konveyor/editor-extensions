let kaiData = [];

const CHART_COLORS = {
  // Cool and Vivid Colors
  blue: 'rgb(54, 162, 235)',
  green: 'rgb(48, 217, 87)',
  red: 'rgb(255, 102, 102)',
  purple: 'rgb(153, 102, 255)',
  cyan: 'rgb(176, 58, 111)',
  darkBlue: 'rgb(0, 0, 139)',
  yellow: 'rgb(255, 205, 86)',
  orange: 'rgb(255, 159, 64)',
  // Warm and Muted/Pastel Colors
  lightOrange: 'rgb(255, 200, 112)',
  lightBlue: 'rgb(122, 213, 255)',
  lightPurple: 'rgb(199, 171, 255)',
  // Transparent colors
  redTransparent: 'rgba(255, 99, 132, 0.5)',
  orangeTransparent: 'rgba(255, 159, 64, 0.5)',
  yellowTransparent: 'rgba(255, 205, 86, 0.5)',
  blueTransparent: 'rgba(54, 162, 235, 0.5)',
  purpleTransparent: 'rgba(153, 102, 255, 0.5)',
  lightBlueTransparent: 'rgb(122, 213, 255, 0.5)',
  lightPurpleTransparent: 'rgb(199, 171, 255, 0.5)',
};

const OVERALL_PERFORMANCE_CHART_OPTIONS = {
  responsive: true,
  scales: {
    x: {
      barPercentage: 0.1,
    },
    y: {
      beginAtZero: true,
      suggestedMax: 10,
    },
  },
  plugins: {
    legend: {
      display: true,
    },
    tooltip: {
      position: 'nearest',
      bodyFont: {
        size: 16,
      },
      titleFont: {
        size: 18,
      },
      padding: 12,
    },
  },
};

const kaiPerformanceJSON = 'https://kaiqe.s3.us-east-1.amazonaws.com/report.json';

function createDatePicker() {
  const datePicker = document.getElementById('date-picker');

  const dates = kaiData.map((obj) => new Date(obj.date));
  datePicker.min = dates[0];
  datePicker.max = dates[dates.length - 1];

  datePicker.addEventListener('change', (event) => {
    const selectedDate = new Date(event.target.value);
    const singleRunsSelectorContainer = document.getElementById('single-runs-selectors-container');
    const container = document.getElementById('single-run-overview');
    const singleRunsList = document.getElementById('single-runs-selectors-list');
    singleRunsList.innerHTML = '';
    singleRunsSelectorContainer.style.display = 'none';
    container.style.display = 'none';
    clearAllSingleRunDetails();

    console.log(dates);
    console.log(selectedDate);

    const filteredData = kaiData.filter((item) => {
      const itemDate = new Date(item.date);
      return itemDate.toLocaleDateString() === selectedDate.toLocaleDateString();
    });

    if (!filteredData.length) {
      return;
    }

    if (filteredData.length > 1) {
      createSingleRunsSelectors(filteredData);
      return;
    }

    createSingleRunDetails(filteredData[0]);
  });
}

function resetCanvasElements(chartIds, containerId) {
  chartIds.forEach((chartId) => {
    const existingCanvas = document.getElementById(chartId);
    if (existingCanvas) {
      existingCanvas.remove();
    }
    const newCanvas = document.createElement('canvas');
    newCanvas.id = chartId;
    document.getElementById(containerId).appendChild(newCanvas);
  });
}

function addRangePicker(options = {}) {
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const defaultOptions = {
    mode: 'range',
    dateFormat: 'Y-m-d',
    defaultDate: [new Date(), lastWeek],
    onClose: function (selectedDates) {
      if (selectedDates.length !== 2) return;

      const startDate = selectedDates[0];
      const endDate = selectedDates[1];

      const filteredData = filterDataByRangeDate(startDate, endDate);

      resetCanvasElements(['kai-performance-chart'], 'history-performance');

      kaiPerformanceChart(filteredData);
    },
  };

  const finalOptions = { ...defaultOptions, ...options };

  flatpickr('#date-range-input', finalOptions);
}

async function fetchJson() {
  try {
    const response = await fetch(kaiPerformanceJSON);
    if (!response.ok) {
      console.error('There was a problem with the fetch operation');
      return;
    }
    kaiData = await response.json();
  } catch (error) {
    console.error('There was a problem with the fetch operation:', error);
  }
}

function kaiPerformanceChart(filteredData) {
  filteredData.sort((a, b) => new Date(a.date) - new Date(b.date));

  const formattedDates = filteredData.map((item) => {
    const date = new Date(item.date).toLocaleString();
    return `${date} | ${item.model}`;
  });

  const chartData = {
    labels: formattedDates,
    grouped: true,
    datasets: [
      {
        label: 'Average Score',
        data: filteredData.map((item) => item.averageScore),
        borderColor: CHART_COLORS.blue,
        backgroundColor: CHART_COLORS.lightBlue,
        borderWidth: 1,
      },
      {
        label: 'Average Competency',
        data: filteredData.map((item) => item.averageCompetency),
        borderColor: CHART_COLORS.purple,
        backgroundColor: CHART_COLORS.lightPurple,
        borderWidth: 1,
      },
      {
        label: 'Average Effectiveness',
        data: filteredData.map((item) => item.averageEffectiveness),
        borderColor: CHART_COLORS.green,
        backgroundColor: CHART_COLORS.green,
        borderWidth: 1,
      },
      {
        label: 'Average Specificity',
        data: filteredData.map((item) => item.averageSpecificity),
        borderColor: CHART_COLORS.cyan,
        backgroundColor: CHART_COLORS.cyan,
        borderWidth: 1,
      },
    ],
  };

  createChart('kai-performance-chart', 'bar', chartData, OVERALL_PERFORMANCE_CHART_OPTIONS);
}

function createChart(chartID, type, data, options) {
  const ctx = document.getElementById(chartID).getContext('2d');
  new Chart(ctx, {
    type: type,
    data: data,
    options: options,
  });
}

function initializeComponents() {
  addRangePicker();
  createDatePicker();
  const helpBtn = document.getElementById('help-button');
  helpBtn.onclick = () => {
    Swal.fire({
      title: 'Kai Evaluation Metrics',
      html: `
       <div style="text-align: left; font-size: 15px;">
          <p><strong>Effectiveness:</strong><br>
            A grade from 0 to 10 of how effectively the changes migrate the file from the source technology to the target technology.
          </p>
          
          <p><strong>Specificity:</strong><br>
            A grade from 0 to 10 of how targeted the changes are at specifically addressing the incidents identified by Konveyor.
          </p>
          
          <p><strong>Competency:</strong>  <br>
            A grade from 0 to 10 of how competently the changes reflect industry best practice for the language and target technology.
          </p>
          
          <p><strong>Valid Code (boolean):</strong><br>
            Indicates the changed file is valid, syntactically correct code that can be successfully compiled or interpreted. <a href="https://github.com/tree-sitter/node-tree-sitter">Tree-Sitter</a>
          </p>
          
          <p><strong>Unnecessary Changes (boolean):</strong> <br>
            Indicates whether unnecessary changes were made that do not advance the goal of migration.
          </p>
          
          <p><strong>Buildable (boolean):</strong> <br>
            Indicates whether the project can be built with maven after applying all the proposed fixes
          </p>
        </div>
      `,
      confirmButtonText: 'Close',
      width: 600,
    });
  };
}

function filterDataByRangeDate(startDate, endDate) {
  return kaiData.filter((item) => {
    const itemDate = new Date(item.date);
    return itemDate >= startDate && itemDate <= endDate;
  });
}

async function init() {
  await fetchJson();
  initializeComponents();
  const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  kaiPerformanceChart(filterDataByRangeDate(lastWeek, new Date()));
}

init();
