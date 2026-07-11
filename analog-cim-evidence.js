(function () {
  'use strict';

  var levelLabels = {
    measured: 'Measured silicon',
    partial: 'Partial / hybrid',
    conditional: 'Modeled / preprint',
    open: 'Open problem review',
    vendor: 'Vendor claim'
  };

  var claimStatus = {
    answered: {
      label: 'Answered in sources',
      className: 'status-measured'
    },
    conditional: {
      label: 'Study-dependent',
      className: 'status-partial'
    },
    open: {
      label: 'Evidence incomplete',
      className: 'status-open'
    }
  };

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderStudies(studies) {
    var body = document.getElementById('evidence-body');
    if (!body) return;

    studies.forEach(function (study) {
      var row = document.createElement('tr');

      var titleCell = document.createElement('th');
      titleCell.scope = 'row';
      titleCell.className = 'evidence-title';
      var link = element('a', '', study.title);
      link.href = study.sourceUrl;
      titleCell.append(link, element('span', '', study.venue + ' | ' + study.year));

      var levelCell = document.createElement('td');
      levelCell.appendChild(element('span', 'status-pill status-' + study.evidenceLevel, levelLabels[study.evidenceLevel] || study.evidenceLevel));

      var scopeCell = document.createElement('td');
      scopeCell.append(element('strong', '', study.technology), document.createTextNode(' ' + study.scope));

      var resultCell = element('td', '', study.reportedResult);

      var readingCell = document.createElement('td');
      readingCell.append(
        element('strong', '', 'Supports: '),
        document.createTextNode(study.whatItShows),
        document.createElement('br'),
        element('strong', '', 'Does not prove: '),
        document.createTextNode(study.whatItDoesNotShow),
        document.createElement('br'),
        element('em', '', study.verdict)
      );

      row.append(titleCell, levelCell, scopeCell, resultCell, readingCell);
      body.appendChild(row);
    });
  }

  function renderIssues(issues) {
    var body = document.getElementById('issues-body');
    if (!body) return;

    issues.forEach(function (issue) {
      var row = document.createElement('tr');
      [issue.layer, issue.symptom, issue.rootCause, issue.mitigations, issue.cost]
        .forEach(function (value, index) {
          var cell = document.createElement(index === 0 ? 'th' : 'td');
          if (index === 0) cell.scope = 'row';
          cell.textContent = value;
          row.appendChild(cell);
        });
      body.appendChild(row);
    });
  }

  function renderClaimTests(tests) {
    var root = document.getElementById('claim-tests');
    if (!root) return;
    tests.forEach(function (test) {
      var item = element('li', 'claim-item');
      var heading = element('div', 'claim-heading');
      var status = claimStatus[test.status] || claimStatus.conditional;
      var title = element('h3', '', test.question);
      var pill = element('span', 'status-pill ' + status.className, status.label);
      var answer = element('p', 'claim-answer', test.answer);
      var limit = element('p', 'claim-limit');
      var sources = element('div', 'claim-sources');

      limit.append(
        element('strong', '', 'Remaining limit: '),
        document.createTextNode(test.limit)
      );

      sources.appendChild(element('span', 'claim-source-label', 'Primary evidence'));
      test.sources.forEach(function (source) {
        var link = element('a', '', source.label);
        link.href = source.url;
        sources.appendChild(link);
      });

      heading.append(title, pill);
      item.append(heading, answer, limit, sources);
      root.appendChild(item);
    });
  }

  function showError(error) {
    var message = 'Evidence data could not be loaded: ' + error.message;
    var evidenceBody = document.getElementById('evidence-body');
    var issuesBody = document.getElementById('issues-body');
    var claimTests = document.getElementById('claim-tests');

    [evidenceBody, issuesBody].forEach(function (root) {
      if (!root) return;
      var row = document.createElement('tr');
      var cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = message;
      row.appendChild(cell);
      root.replaceChildren(row);
    });

    if (claimTests) claimTests.replaceChildren(element('li', '', message));
  }

  fetch('data/analog-cim-evidence.json')
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-research-date]'), function (node) {
        node.textContent = data.meta.updated;
      });
      renderStudies(data.studies);
      renderIssues(data.issues);
      renderClaimTests(data.claimTests);
    })
    .catch(showError);
}());
