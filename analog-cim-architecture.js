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
    var detailHost = document.getElementById('stage-detail');
    if (!list || !detailHost) return;
    if (!Array.isArray(data.signalPath) || data.signalPath.length === 0) {
      throw new Error('Architecture stages are missing');
    }

    var stageButtons = [];
    var stagePanels = [];
    var usedStageTokens = Object.create(null);

    function stageToken(stage, index) {
      var source = typeof stage.id === 'string' && stage.id.trim()
        ? stage.id
        : 'stage-' + (index + 1);
      var stem = source
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'stage-' + (index + 1);
      var token = stem;
      var suffix = 2;
      while (usedStageTokens[token]) {
        token = stem + '-' + suffix;
        suffix += 1;
      }
      usedStageTokens[token] = true;
      return token;
    }

    function selectStage(selectedIndex, moveFocus) {
      stageButtons.forEach(function (button, index) {
        var selected = index === selectedIndex;
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        stagePanels[index].hidden = !selected;
      });
      if (moveFocus) stageButtons[selectedIndex].focus();
    }

    list.replaceChildren();
    list.setAttribute('role', 'tablist');
    list.setAttribute('aria-orientation', 'vertical');
    detailHost.replaceChildren();

    data.signalPath.forEach(function (stage, index) {
      var token = stageToken(stage, index);
      var button = element('button', 'stage-button');
      button.type = 'button';
      button.id = 'stage-tab-' + token;
      button.setAttribute('role', 'tab');

      var panel = element('div', 'panel stage-detail');
      panel.id = 'stage-panel-' + token;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', button.id);
      panel.tabIndex = 0;
      renderStageDetail(stage, sources, panel);

      button.setAttribute('aria-controls', panel.id);

      var number = element('span', 'stage-number', String(stage.order));
      var copy = element('span');
      copy.append(element('strong', '', stage.label), element('span', '', stage.domain));
      button.append(number, copy);
      button.addEventListener('click', function () {
        selectStage(index, false);
      });
      button.addEventListener('keydown', function (event) {
        var targetIndex = -1;
        if (event.key === 'ArrowDown') {
          targetIndex = (index + 1) % data.signalPath.length;
        } else if (event.key === 'ArrowUp') {
          targetIndex = (index - 1 + data.signalPath.length) % data.signalPath.length;
        } else if (event.key === 'Home') {
          targetIndex = 0;
        } else if (event.key === 'End') {
          targetIndex = data.signalPath.length - 1;
        }
        if (targetIndex < 0) return;
        event.preventDefault();
        selectStage(targetIndex, true);
      });
      stageButtons.push(button);
      stagePanels.push(panel);
      list.appendChild(button);
      detailHost.appendChild(panel);
    });

    selectStage(0, false);
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
      if (!root) return;
      if (id === 'stage-list') {
        root.removeAttribute('role');
        root.removeAttribute('aria-orientation');
      }
      root.replaceChildren(element('p', 'muted', 'Learning data could not be loaded: ' + error.message));
    });
  }

  fetch('data/analog-cim-architecture.json?v=2026-07-12-noc-congestion')
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
