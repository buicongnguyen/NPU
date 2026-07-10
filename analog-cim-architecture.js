(function () {
  'use strict';

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sourceMap(sources) {
    return sources.reduce(function (map, source) {
      map[source.id] = source;
      return map;
    }, {});
  }

  function renderStageDetail(stage, sources, detailRoot) {
    var kicker = element('p', 'kicker', stage.domain + ' layer');
    var title = element('h3', '', stage.order + '. ' + stage.label);
    var summary = element('p', 'lede', stage.summary);
    var detail = element('p', '', stage.detail);
    var meta = element('div', 'detail-meta');

    [
      ['Primary failure mode', stage.failureMode],
      ['Mitigation pattern', stage.mitigation],
      ['Interview prompt', stage.interviewPrompt]
    ].forEach(function (item) {
      var box = element('div');
      box.append(element('strong', '', item[0]), element('span', '', item[1]));
      meta.appendChild(box);
    });

    var sourceBox = element('div');
    sourceBox.appendChild(element('strong', '', 'Primary evidence'));
    var sourceLine = element('span');
    stage.sourceIds.forEach(function (sourceId, index) {
      var source = sources[sourceId];
      if (!source) return;
      if (index > 0) sourceLine.appendChild(document.createTextNode(' | '));
      var link = element('a', '', source.title);
      link.href = source.url;
      sourceLine.appendChild(link);
    });
    sourceBox.appendChild(sourceLine);
    meta.appendChild(sourceBox);

    detailRoot.replaceChildren(kicker, title, summary, detail, meta);
  }

  function renderStages(data, sources) {
    var list = document.getElementById('stage-list');
    var detail = document.getElementById('stage-detail');
    if (!list || !detail) return;
    var stageButtons = [];

    function selectStage(stage, selectedButton, moveFocus) {
      Array.prototype.forEach.call(list.querySelectorAll('button'), function (button) {
        button.setAttribute('aria-selected', button === selectedButton ? 'true' : 'false');
        button.tabIndex = button === selectedButton ? 0 : -1;
      });
      renderStageDetail(stage, sources, detail);
      if (moveFocus) selectedButton.focus();
    }

    data.signalPath.forEach(function (stage, index) {
      var button = element('button', 'stage-button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'stage-detail');
      button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      button.tabIndex = index === 0 ? 0 : -1;

      var number = element('span', 'stage-number', String(stage.order));
      var copy = element('span');
      copy.append(element('strong', '', stage.label), element('span', '', stage.domain));
      button.append(number, copy);
      button.addEventListener('click', function () {
        selectStage(stage, button, false);
      });
      button.addEventListener('keydown', function (event) {
        var targetIndex = -1;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          targetIndex = (index + 1) % data.signalPath.length;
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          targetIndex = (index - 1 + data.signalPath.length) % data.signalPath.length;
        } else if (event.key === 'Home') {
          targetIndex = 0;
        } else if (event.key === 'End') {
          targetIndex = data.signalPath.length - 1;
        }
        if (targetIndex < 0) return;
        event.preventDefault();
        selectStage(data.signalPath[targetIndex], stageButtons[targetIndex], true);
      });
      stageButtons.push(button);
      list.appendChild(button);
    });

    if (data.signalPath.length) {
      renderStageDetail(data.signalPath[0], sources, detail);
    }
  }

  function renderMetrics(data, sources) {
    var root = document.getElementById('mythic-metrics');
    if (!root) return;

    data.mythicSnapshot.forEach(function (metric) {
      var card = element('article', 'metric');
      var source = sources[metric.sourceId];
      card.append(
        element('strong', '', metric.value),
        element('span', '', metric.label),
        element('small', '', metric.context + '. ' + metric.evidence + '.')
      );
      if (source) {
        var link = element('a', '', 'Evidence');
        link.href = source.url;
        card.appendChild(link);
      }
      root.appendChild(card);
    });
  }

  function renderComparison(data) {
    var body = document.getElementById('technology-comparison-body');
    if (!body) return;

    data.technologyComparison.forEach(function (item) {
      var row = document.createElement('tr');
      [item.system, item.memory, item.weightRole, item.inputOutput, item.bestFit, item.mainCaveat]
        .forEach(function (value, index) {
          var cell = document.createElement(index === 0 ? 'th' : 'td');
          if (index === 0) cell.scope = 'row';
          cell.textContent = value;
          row.appendChild(cell);
        });
      body.appendChild(row);
    });
  }

  function renderSources(data) {
    var root = document.getElementById('architecture-sources');
    if (!root) return;

    data.sources.forEach(function (source) {
      var card = element('article', 'source-card');
      var link = element('a', '', source.title);
      link.href = source.url;
      var meta = element('span', '', source.publisher + ' | ' + source.year + ' | ' + source.type);
      card.append(link, meta);
      root.appendChild(card);
    });
  }

  function showError(error) {
    ['stage-list', 'stage-detail', 'mythic-metrics', 'architecture-sources'].forEach(function (id) {
      var root = document.getElementById(id);
      if (root) root.replaceChildren(element('p', 'muted', 'Learning data could not be loaded: ' + error.message));
    });
  }

  fetch('data/analog-cim-architecture.json')
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(function (data) {
      var sources = sourceMap(data.sources);
      Array.prototype.forEach.call(document.querySelectorAll('[data-research-date]'), function (node) {
        node.textContent = data.meta.updated;
      });
      renderStages(data, sources);
      renderMetrics(data, sources);
      renderComparison(data);
      renderSources(data);
    })
    .catch(showError);
}());
