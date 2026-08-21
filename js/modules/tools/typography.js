/* 鑫洋助理工具模块：typography（v2.2.58） */
(function (global) {
  "use strict";
  if (global.XinyangToolsTypography) return;

  global.XinyangToolsTypography = {
    create: function (deps) {
      deps = deps || {};
      var config = deps.config;
      var isBusy = deps.isBusy;
      var $ = deps.$;
      var all = deps.all;
      var status = deps.status;
      var humanError = deps.humanError;
      var hostInvoke = deps.hostInvoke;
      var saveConfig = deps.saveConfig;
      var setBusy = deps.setBusy;
      var nodeValue = deps.nodeValue;
      var setNodeValue = deps.setNodeValue;
      var normalizeMetricNumber = deps.normalizeMetricNumber;
      var setMetricNodeValue = deps.setMetricNodeValue;
      var setNodeChecked = deps.setNodeChecked;
      var bindNode = deps.bindNode;
      var toggleHidden = deps.toggleHidden;
      var cs = deps.cs;

      var fontsLoaded = false;
      var fontCatalog = [];
      var realtimeTextTimer = null;
      var realtimeTextBusy = false;
      var realtimeTextQueued = false;
      var realtimeTextReady = false;
      var pendingTextFormattingFields = {};
      var textFormattingRevision = 0;
      var textStyleReadInFlight = false;
      var typographyRefreshTimer = 0;
      var typographyFallbackTimer = 0;
      var typographyRefreshRequestId = 0;
      var typographyRefreshInFlight = false;
      var typographyRefreshQueued = false;
      var typographyWriteInFlight = false;
      var typographyEventName = "";
      var typographyEventListener = null;
      var lastTextSelectionSignature = "";
      var textPanelVisible = false;
      /* 最近一次宿主快照，供诊断面板/CEP 控制台读取，不产生额外宿主请求。 */
      var typographySnapshotPerformance = {
        selectionCount: 0,
        snapshotDuration: 0,
        executeActionGetCount: 0,
        descriptorParseDuration: 0,
        mixedCalculationDuration: 0
      };
      var textColorPickerBusy = false;
      var wordsGapDirection = "vertical";
      var DEFAULT_WORDS_PRESETS = {
        fontSize: [6,8,10,11,12,14,16,18,24,30,36,48,60,72,84,96,108,120],
        lineSpace: [1,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2,2.5],
        wordSpace: [-100,-50,-25,0,25,50,75,100,200,300,500,1000]
      };

      function setWordsDisclosureState(control, open) {
        var button = typeof control === "string" ? $(control) : control;
        if (!button) return;
        button.classList.toggle("open", !!open);
        button.setAttribute("aria-expanded", open ? "true" : "false");
      }

      function syncWordsDisclosureForPanel(panel, open) {
        if (!panel || !panel.id) return;
        all('#typography-panel [aria-controls="' + panel.id + '"]').forEach(function (button) {
          setWordsDisclosureState(button, open);
        });
      }

      function closeWordsPopovers(except) {
        all("#typography-panel .words-inline-popover, #typography-panel .words-preset-popup, #typography-panel .words-floating-menu, #typography-panel .words-padding-history, #typography-panel .words-layout-ratio-list").forEach(function (node) {
          if (node !== except) {
            node.setAttribute("hidden", "");
            syncWordsDisclosureForPanel(node, false);
          }
        });
      }

      function escapeHtml(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function parseNumberList(value, fallback) {
        var values = String(value == null ? "" : value).split(/[,，\s]+/).map(Number).filter(function (number) {
          return isFinite(number);
        });
        return values.length ? values : (fallback || []).slice(0);
      }

      function markChip(containerId, value) {
        all("#" + containerId + " button[data-value]").forEach(function (button) {
          button.classList.toggle("active", Number(button.getAttribute("data-value")) === Number(value));
        });
      }

      function markAlign(value) {
        all("[data-text-align]").forEach(function (button) {
          button.classList.toggle("active", button.getAttribute("data-text-align") === value);
        });
      }

      function markTextToggle(name, value) {
        all('[data-text-toggle="' + name + '"]').forEach(function (button) {
          button.classList.toggle("active", !!value);
          button.setAttribute("aria-pressed", value ? "true" : "false");
        });
      }

      function textPresetSizes(name) {
        var presets = config.hierarchyPresets || {};
        return (presets[name] || presets.regular || [92,48,36,24,15,12]).slice(0);
      }

      function updateFontSizeChips() {
        var values = textPresetSizes(config.textPreset);
        var container = $("#font-size-chips");
        if (!container) return;
        container.innerHTML = values.map(function (value) {
          return '<button type="button" data-value="' + value + '">' + value + '</button>';
        }).join("");
        config.autoLayoutSizes = values.join(",");
        setNodeValue("#auto-layout-sizes", config.autoLayoutSizes);
        markChip("font-size-chips", config.fontSize);
      }

      function renderHierarchyEditor() {
        var node = $("#words-hierarchy-inputs");
        if (!node) return;
        node.innerHTML = textPresetSizes(config.textPreset).map(function (value, index) {
          return '<label><span>' + (index + 1) + '</span><input type="number" min="1" value="' + value + '"/></label>';
        }).join("");
      }

      function saveHierarchyPreset(createNew) {
        var values = all("#words-hierarchy-inputs input").map(function (input) { return Number(input.value); }).filter(function (value) { return value > 0; });
        if (!values.length) return status("请至少输入一个有效字号");
        var key = config.textPreset;
        if (createNew) {
          key = "custom" + (Object.keys(config.hierarchyPresets || {}).length + 1);
          var select = $("#text-preset-select");
          if (select) {
            var option = document.createElement("option");
            option.value = key;
            option.textContent = "自定义" + key.replace("custom", "");
            select.appendChild(option);
            select.value = key;
          }
          config.textPreset = key;
        }
        config.hierarchyPresets[key] = values;
        updateFontSizeChips();
        saveConfig();
        status(createNew ? "已新建字号层级预设" : "已保存当前字号层级");
      }

      function pinnedFontPriority(family) {
        var value = String(family || "").toLowerCase();
        var compact = value.replace(/[\s_\-]+/g, "");
        if (/思源黑体.*cn/.test(value) || /sourcehansanscn/.test(compact)) return 0;
        if (/鸿蒙.*黑|harmonyos.*sans|harmonyossans/.test(value) || /harmonyossans/.test(compact)) return 1;
        if (/思源宋体.*cn/.test(value) || /sourcehanserifcn/.test(compact)) return 2;
        if (/^impact$/.test(value.trim()) || /^impact/.test(compact)) return 3;
        if (/^arial$/.test(value.trim()) || /^arialmt$/.test(compact)) return 4;
        return 100;
      }

      function uniqueFontFamilies() {
        var output = [];
        var seen = {};
        fontCatalog.forEach(function (font) {
          var family = String(font.family || font.postScriptName || "");
          if (!family || seen[family]) return;
          seen[family] = true;
          output.push(family);
        });
        return output.sort(function (a, b) {
          var leftPriority = pinnedFontPriority(a);
          var rightPriority = pinnedFontPriority(b);
          if (leftPriority !== rightPriority) return leftPriority - rightPriority;
          return a.localeCompare(b);
        });
      }

      function fontCategoryMatch(family, category) {
        var value = String(family || "").toLowerCase();
        if (category === "serif") return /宋|明朝|serif|mincho|song|simsun|source han serif|noto serif/.test(value);
        if (category === "script") return /楷|行|隶|草|手写|script|hand|kai|xing|callig/.test(value);
        if (category === "latin") return !/[\u3400-\u9fff]/.test(value) && !/黑|宋|楷|仿|圆|微软雅黑|思源/.test(value);
        return /黑|sans|hei|gothic|雅黑|思源黑|noto sans|source han sans|苹方|圆/.test(value) || !fontCategoryMatch(family, "serif");
      }

      function positionFontResults() {
        var combo = $("#tool-font-combobox");
        var results = $("#tool-font-results");
        var panel = $("#typography-panel");
        if (!combo || !results || !panel) return;
        var viewportWidth = Math.max(220, document.documentElement.clientWidth || window.innerWidth || 0);
        var comboRect = combo.getBoundingClientRect();
        var panelRect = panel.getBoundingClientRect();
        var minimumLeft = Math.max(panelRect.left + 5, 0);
        var maximumRight = Math.max(minimumLeft + 188, viewportWidth - 6);
        var availableWidth = Math.max(188, maximumRight - minimumLeft);
        var desiredWidth = Math.max(220, Math.min(260, comboRect.width + 86));
        var width = Math.min(desiredWidth, availableWidth);
        var absoluteLeft = Math.max(minimumLeft, Math.min(comboRect.left, maximumRight - width));
        results.style.left = Math.round(absoluteLeft - comboRect.left) + "px";
        results.style.right = "auto";
        results.style.width = Math.round(width) + "px";
        results.style.maxWidth = Math.round(availableWidth) + "px";
      }

      function setFontResultsOpen(open) {
        var combo = $("#tool-font-combobox");
        var results = $("#tool-font-results");
        var arrow = $("#tool-load-fonts");
        if (!combo || !results || !arrow) return;
        combo.classList.toggle("open", !!open);
        results.classList.toggle("open", !!open);
        setWordsDisclosureState(arrow, !!open);
        if (open) {
          positionFontResults();
        } else {
          var search = $("#tool-font-search");
          if (search) search.value = String(config.fontFamily || "");
          var category = $("#words-font-category");
          var categoryButton = $('#words-font-tabs [data-font-filter="category"]');
          if (category) {
            category.hidden = true;
            category.setAttribute("hidden", "");
          }
          setWordsDisclosureState(categoryButton, false);
        }
      }

      function openFontResultsFresh() {
        setNodeValue("#tool-font-search", "");
        renderFontFamilyResults("");
        setFontResultsOpen(true);
      }

      function renderFontFamilyResults(query) {
        var results = $("#words-font-result-list") || $("#tool-font-results");
        if (!results) return;
        if (!fontsLoaded) {
          results.innerHTML = '<div class="text-font-empty">点击右侧箭头读取 Photoshop 字体</div>';
          return;
        }
        var keyword = String(query || "").trim().toLowerCase();
        var families = uniqueFontFamilies();
        if (config.fontFilter === "recent") {
          var recent = config.recentFonts || [];
          families = recent.filter(function (family) { return families.indexOf(family) >= 0; });
        } else if (config.fontFilter === "category") {
          families = families.filter(function (family) { return fontCategoryMatch(family, config.fontCategory); });
        }
        families = families.filter(function (family) {
          return !keyword || family.toLowerCase().indexOf(keyword) >= 0;
        }).slice(0, 120);
        results.innerHTML = families.length ? families.map(function (family) {
          return '<button class="text-font-result' + (family === config.fontFamily ? " active" : "") + '" data-font-family="' + encodeURIComponent(family) + '" role="option" type="button">' + escapeHtml(family) + '</button>';
        }).join("") : '<div class="text-font-empty">没有匹配字体</div>';
      }

      function selectedFontEntry() {
        var family = nodeValue("#tool-font-family", config.fontFamily);
        var style = nodeValue("#tool-font-style", config.fontStyle);
        var exact = fontCatalog.filter(function (font) {
          return String(font.family || "") === family && String(font.style || "") === style;
        });
        return exact[0] || fontCatalog.filter(function (font) { return String(font.family || "") === family; })[0] || null;
      }

      function cssWeightFromFontStyle(style) {
        var text = String(style || "").toLowerCase();
        if (/thin|hairline|纤细|极细/.test(text)) return 100;
        if (/extra[ -]?light|ultra[ -]?light|特细|超细/.test(text)) return 200;
        if (/light|细体|细/.test(text)) return 300;
        if (/medium|中等|中黑|中粗/.test(text)) return 500;
        if (/semi[ -]?bold|demi[ -]?bold|半粗/.test(text)) return 600;
        if (/extra[ -]?bold|ultra[ -]?bold|特粗|超粗/.test(text)) return 800;
        if (/black|heavy|poster|粗黑|黑体/.test(text)) return 900;
        if (/bold|粗体|粗/.test(text)) return 700;
        return 400;
      }

      function renderFontStyleChips() {
        var family = nodeValue("#tool-font-family", config.fontFamily);
        var styles = fontCatalog.filter(function (font) { return String(font.family || "") === family; });
        var container = $("#font-style-chips");
        if (!container) return;
        container.innerHTML = styles.map(function (font) {
          var style = String(font.style || "常规");
          var selected = String(nodeValue("#tool-font-style", "")) === style;
          var fontName = String(font.postScriptName || family || "sans-serif");
          return '<button type="button" data-font-style="' + escapeHtml(style) + '" aria-pressed="' + (selected ? "true" : "false") + '" title="' + escapeHtml(style) + '" class="' + (selected ? "active" : "") + '"><span style="font-family:' + escapeHtml(fontName) + ';font-weight:' + cssWeightFromFontStyle(style) + '">T</span></button>';
        }).join("");
      }

      function syncFontSelection() {
        var entry = selectedFontEntry();
        if (!entry) return;
        config.fontFamily = String(entry.family || "");
        config.fontStyle = String(entry.style || "");
        config.font = String(entry.postScriptName || "");
        setNodeValue("#tool-font-input", config.font);
        var current = $("#tool-current-font-name");
        if (current) current.textContent = config.fontFamily + (config.fontStyle ? " " + config.fontStyle : "");
        setNodeValue("#tool-font-search", config.fontFamily);
        renderFontStyleChips();
        addRecentFont(config.fontFamily);
        saveConfig();
      }

      function populateFontStyles(preferredStyle) {
        var family = nodeValue("#tool-font-family", config.fontFamily);
        var styles = fontCatalog.filter(function (font) { return String(font.family || "") === family; });
        var select = $("#tool-font-style");
        if (!select) return;
        select.innerHTML = "";
        styles.forEach(function (font) {
          var option = document.createElement("option");
          option.value = String(font.style || "常规");
          option.textContent = String(font.style || "常规");
          select.appendChild(option);
        });
        if (preferredStyle && styles.some(function (font) { return String(font.style || "") === String(preferredStyle); })) select.value = preferredStyle;
        syncFontSelection();
      }

      function populateFontFamilies() {
        var select = $("#tool-font-family");
        if (!select) return;
        var match = fontCatalog.filter(function (font) { return String(font.postScriptName || "") === String(config.font || ""); })[0];
        var preferredFamily = config.fontFamily || (match && match.family) || uniqueFontFamilies()[0] || "";
        var preferredStyle = config.fontStyle || (match && match.style) || "";
        select.innerHTML = "";
        uniqueFontFamilies().forEach(function (family) {
          var option = document.createElement("option");
          option.value = family;
          option.textContent = family;
          select.appendChild(option);
        });
        if (preferredFamily) select.value = preferredFamily;
        populateFontStyles(preferredStyle);
        setNodeValue("#tool-font-search", select.value || preferredFamily);
        renderFontFamilyResults("");
        renderQuickFonts();
      }

      function loadFonts(quiet, openAfter, queryAfterLoad) {
        var preserveQuery = arguments.length >= 3;
        var requestedQuery = preserveQuery ? String(queryAfterLoad || "") : "";
        if (fontsLoaded) {
          if (openAfter && !preserveQuery) {
            openFontResultsFresh();
          } else {
            setNodeValue("#tool-font-search", requestedQuery || nodeValue("#tool-font-search", ""));
            renderFontFamilyResults(requestedQuery || nodeValue("#tool-font-search", ""));
            if (openAfter) setFontResultsOpen(true);
          }
          return;
        }
        if (isBusy()) return;
        setBusy(true, quiet ? "正在准备文字面板…" : "正在读取 Photoshop 字体列表…");
        hostInvoke("toolsGetFonts", {}).then(function (result) {
          fontCatalog = result.fonts || [];
          fontsLoaded = true;
          populateFontFamilies();
          if (openAfter) {
            setNodeValue("#tool-font-search", requestedQuery);
            renderFontFamilyResults(requestedQuery);
            setFontResultsOpen(true);
          }
          status("已读取 " + fontCatalog.length + " 个 Photoshop 字体");
        }).catch(function (error) {
          status("读取字体失败：" + humanError(error));
        }).then(function () {
          setBusy(false);
          if (quiet) requestTypographyRefresh("fonts-ready", 180);
        });
      }

      function addRecentFont(family) {
        if (!family) return;
        var values = (config.recentFonts || []).filter(function (item) { return item !== family; });
        values.unshift(family);
        config.recentFonts = values.slice(0, 20);
      }

      function selectFontFamily(family) {
        var select = $("#tool-font-family");
        if (!select || !family) return;
        var exists = Array.prototype.some.call(select.options, function (option) { return option.value === family; });
        if (!exists) return;
        select.value = family;
        config.fontFamily = family;
        setNodeValue("#tool-font-search", family);
        populateFontStyles(config.fontStyle || "");
        renderFontFamilyResults(family);
        setFontResultsOpen(false);
        scheduleRealtimeTextFormatting(60, "font");
      }

      function renderQuickFonts() {
        var list = $("#words-quick-weight-list");
        var menu = $("#words-quick-font-menu");
        var name = $("#words-quick-font-name");
        if (!list || !menu || !name) return;
        var quick = config.quickFonts || [];
        if (!quick.length && config.fontFamily) quick = [{ family: config.fontFamily }];
        if (config.quickFontIndex >= quick.length) config.quickFontIndex = 0;
        var current = quick[config.quickFontIndex] || null;
        name.textContent = current ? current.family : "快捷字体";
        menu.innerHTML = quick.length ? quick.map(function (item, index) {
          return '<button type="button" data-quick-font-index="' + index + '">' + escapeHtml(item.family) + '<span data-remove-quick-font="' + index + '">×</span></button>';
        }).join("") : '<div class="text-font-empty">添加当前图层字体后显示</div>';
        if (!current || !fontsLoaded) { list.innerHTML = ""; return; }
        var styles = fontCatalog.filter(function (font) { return String(font.family || "") === current.family; });
        list.innerHTML = styles.slice(0, 8).map(function (font) {
          var style = String(font.style || "常规");
          return '<button type="button" data-quick-font-style="' + escapeHtml(style) + '" title="' + escapeHtml(style) + '"><span>T</span><small>' + escapeHtml(style) + '</small></button>';
        }).join("");
      }

      function addCurrentFontToQuick() {
        readCurrentTextStyle(function () {
          if (!config.fontFamily) return;
          var values = (config.quickFonts || []).filter(function (item) { return item.family !== config.fontFamily; });
          values.push({ family: config.fontFamily });
          config.quickFonts = values.slice(-12);
          config.quickFontIndex = config.quickFonts.length - 1;
          renderQuickFonts();
          saveConfig();
          status("已添加快捷字体：" + config.fontFamily);
        });
      }

      function normalizeTextColorHex(value) {
        var text = String(value || "").trim().replace(/^#/, "");
        if (/^[0-9a-f]{3}$/i.test(text)) {
          text = text.charAt(0) + text.charAt(0) +
            text.charAt(1) + text.charAt(1) +
            text.charAt(2) + text.charAt(2);
        }
        if (!/^[0-9a-f]{6}$/i.test(text)) return "#ffffff";
        return "#" + text.toLowerCase();
      }

      function syncTextColorSwatch(value) {
        var color = normalizeTextColorHex(value || config.textColor);
        var swatch = $("#tool-text-color-swatch");
        var button = $("#tool-text-color-picker");
        if (swatch) swatch.style.backgroundColor = color;
        if (button) {
          button.setAttribute("aria-label", "打开 Photoshop 拾色器，当前颜色 " + color);
          button.setAttribute("title", "当前颜色 " + color + "；点击打开 Photoshop 自带拾色器，可直接吸取画布颜色");
        }
      }

      function extensionFilePath(relativePath) {
        try {
          var root = String(cs.getSystemPath(SystemPath.EXTENSION) || "")
            .replace(/\\/g, "/")
            .replace(/\/+$/, "");
          return root ? root + "/" + String(relativePath || "").replace(/^\/+/, "") : "";
        } catch (error) {
          return "";
        }
      }

      function invokeStandaloneTextButton(payload) {
        return new Promise(function (resolve, reject) {
          var scriptPath = extensionFilePath("jsx/text-button-v2250.jsx");
          if (!scriptPath) { reject(new Error("无法定位独立按钮脚本")); return; }
          var script = '(function(){try{$.evalFile(new File(' + JSON.stringify(scriptPath) +
            '));if(typeof XinyangTextButtonV2250==="undefined"||!XinyangTextButtonV2250.invoke){throw new Error("独立按钮入口未加载");}return XinyangTextButtonV2250.invoke(' +
            JSON.stringify(JSON.stringify(payload || {})) +
            ');}catch(e){return "__XY_BUTTON_ERROR__"+String(e&&e.message?e.message:e)+(e&&e.line?"（脚本第 "+e.line+" 行）":"");}})()';
          cs.evalScript(script, function (raw) {
            try {
              raw = String(raw || "");
              if (!raw || raw === "EvalScript error.") throw new Error("Photoshop 独立按钮脚本执行失败");
              if (raw.indexOf("__XY_BUTTON_ERROR__") === 0) throw new Error(raw.slice(19));
              var result = JSON.parse(raw);
              if (!result.ok) throw new Error(result.error || "生成按钮失败");
              resolve(result.data || {});
            } catch (error) { reject(error); }
          });
        });
      }

      function invokeStandaloneTextColorPicker(payload) {
        return new Promise(function (resolve, reject) {
          var scriptPath = extensionFilePath("jsx/text-color-picker-v2193.jsx");
          if (!scriptPath) {
            reject(new Error("无法定位独立拾色器脚本"));
            return;
          }
          var payloadJson = JSON.stringify(payload || {});
          var script = '(function(){try{$.evalFile(new File(' +
            JSON.stringify(scriptPath) +
            '));if(typeof XinyangTextColorPickerV2193==="undefined"||!XinyangTextColorPickerV2193.invoke){throw new Error("独立拾色器入口未加载");}return XinyangTextColorPickerV2193.invoke(' +
            JSON.stringify(payloadJson) +
            ');}catch(e){return "__XY_PICKER_ERROR__"+String(e&&e.message?e.message:e)+(e&&e.line?"（脚本第 "+e.line+" 行）":"");}})()';
          cs.evalScript(script, function (raw) {
            try {
              raw = String(raw || "");
              if (!raw || raw === "EvalScript error.") throw new Error("Photoshop 独立拾色器脚本执行失败");
              if (raw.indexOf("__XY_PICKER_ERROR__") === 0) throw new Error(raw.slice(19));
              var result = JSON.parse(raw);
              if (!result.ok) throw new Error(result.error || "Photoshop 拾色器操作失败");
              resolve(result.data || {});
            } catch (error) {
              reject(error);
            }
          });
        });
      }

      function openPhotoshopTextColorPicker() {
        if (textColorPickerBusy || isBusy() || realtimeTextBusy) return;
        readTextConfig();
        textColorPickerBusy = true;
        var button = $("#tool-text-color-picker");
        if (button) button.disabled = true;
        status("正在打开 Photoshop 自带拾色器…");
        invokeStandaloneTextColorPicker({ color: config.textColor }).then(function (result) {
          if (result && result.cancelled) {
            status("已取消选择文字颜色");
            return null;
          }
          var color = normalizeTextColorHex(result && result.color || config.textColor);
          config.textColor = color;
          setNodeValue("#tool-text-color", color);
          syncTextColorSwatch(color);
          saveConfig();

          /*
           * v2.1.93：独立拾色器只负责取色，实际修改统一交给
           * toolsApplyTextFormatting。该入口使用 Photoshop suspendHistory，
           * 因此整批颜色修改会形成一条可 Ctrl+Z 撤回的历史记录。
           */
          return hostInvoke("toolsApplyTextFormatting", { color: color }).then(function (applyResult) {
            var processed = Number(applyResult && applyResult.processed) || 0;
            var skipped = Number(applyResult && applyResult.skipped) || 0;
            if (processed > 0) {
              status(
                "已通过 Photoshop 拾色器更新 " + processed +
                " 个文字图层：" + color + "；可按 Ctrl+Z 撤回" +
                (skipped ? "，跳过 " + skipped + " 个非文字图层" : "")
              );
            } else {
              status("已选择文字颜色：" + color + "；当前未选中可修改的文字图层");
            }
            return applyResult;
          }).catch(function (applyError) {
            status("已选择文字颜色：" + color + "；未应用到文字图层：" + humanError(applyError));
            return null;
          });
        }).catch(function (error) {
          status("打开 Photoshop 拾色器失败：" + humanError(error));
        }).then(function () {
          textColorPickerBusy = false;
          if (button) button.disabled = false;
        });
      }

      function readTextConfig() {
        config.font = String(nodeValue("#tool-font-input", config.font) || "").trim();
        config.fontFamily = nodeValue("#tool-font-family", config.fontFamily) || config.fontFamily;
        config.fontStyle = nodeValue("#tool-font-style", config.fontStyle) || config.fontStyle;
        config.fontSize = Math.max(1, normalizeMetricNumber(nodeValue("#tool-font-size", config.fontSize), 0, config.fontSize || 48));
        config.tracking = Math.max(-1000, Math.min(10000, normalizeMetricNumber(nodeValue("#tool-tracking", config.tracking), 0, config.tracking || 0)));
        config.leadingPoints = Math.max(1, normalizeMetricNumber(nodeValue("#tool-leading", config.leadingPoints || config.fontSize * 1.2), 0, config.leadingPoints || config.fontSize * 1.2));
        config.leading = config.leadingPoints / config.fontSize;
        config.textAlign = nodeValue("#tool-text-align", config.textAlign) || "left";
        config.textColor = normalizeTextColorHex(nodeValue("#tool-text-color", config.textColor) || "#ffffff");
        syncTextColorSwatch(config.textColor);
        config.opticalKern = !!($("#words-optical-kern") && $("#words-optical-kern").checked);
        saveConfig();
      }

      function applyTypographySnapshot(result, after, quiet) {
        if (!result || !result.activeIsText || !result.style) return;
        var style = result.style || {};
        var fontInfo = fontCatalog.filter(function (entry) {
          return String(entry.postScriptName || "") === String(style.font || "");
        })[0] || {};
        config.font = style.font || config.font;
        config.fontFamily = String(fontInfo.family || result.family || config.fontFamily);
        config.fontStyle = String(fontInfo.style || result.fontStyle || config.fontStyle);
        config.fontSize = Math.max(1, normalizeMetricNumber(style.size, 0, config.fontSize || 48));
        config.tracking = Math.max(-1000, Math.min(10000, normalizeMetricNumber(style.tracking, 0, 0)));
        config.leadingPoints = Math.max(1, normalizeMetricNumber(style.leading, 0, config.fontSize * 1.2));
        config.leading = config.leadingPoints / config.fontSize;
        config.textAlign = style.align || config.textAlign;
        config.textColor = style.color || config.textColor;
        config.fauxBold = !!style.fauxBold;
        config.fauxItalic = !!style.fauxItalic;
        config.allCaps = !!style.allCaps;
        config.opticalKern = !!style.opticalKern;
        config.textDirection = style.direction || "horizontal";
        restoreWordsUi();
        if (fontsLoaded) populateFontFamilies();
        saveConfig();
        if (!quiet) status("已识别文字属性：" + (result.layerName || "当前图层"));
        if (after) after(result);
      }

      function recordTypographySnapshotPerformance(result) {
        var source = result && result.performance;
        if (!source) return;
        typographySnapshotPerformance.selectionCount = Number(source.selectionCount) || 0;
        typographySnapshotPerformance.snapshotDuration = Number(source.snapshotDuration) || 0;
        typographySnapshotPerformance.executeActionGetCount = Number(source.executeActionGetCount) || 0;
        typographySnapshotPerformance.descriptorParseDuration = Number(source.descriptorParseDuration) || 0;
        typographySnapshotPerformance.mixedCalculationDuration = Number(source.mixedCalculationDuration) || 0;
        global.XinyangTypographySnapshotPerformance = typographySnapshotPerformance;
      }

      function readCurrentTextStyle(after, quiet) {
        if (textStyleReadInFlight || typographyRefreshInFlight || typographyWriteInFlight || (!quiet && isBusy())) return;
        var shouldLoadFonts = !fontsLoaded;
        var readRevision = textFormattingRevision;
        textStyleReadInFlight = true;
        if (!quiet) setBusy(true, "正在识别当前选中文字图层属性…");
        hostInvoke("toolsGetTypographySnapshot", { includeMixed: true }).then(function (result) {
          /*
           * Photoshop 属性读取是异步的。若用户在请求发出后刚修改字号，
           * 这里拿到的可能还是旧字号；禁止它覆盖面板配置并被实时写回。
           */
          if (readRevision !== textFormattingRevision) return;
          recordTypographySnapshotPerformance(result);
          applyTypographySnapshot(result, after, quiet);
        }).catch(function (error) {
          shouldLoadFonts = false;
          if (!quiet) status("识别文字属性失败：" + humanError(error));
        }).then(function () {
          textStyleReadInFlight = false;
          if (!quiet) setBusy(false);
          if (shouldLoadFonts && !fontsLoaded) window.setTimeout(function () { loadFonts(true); }, 20);
        });
      }

      function typographyPanelIsActive() {
        var panel = $("#typography-panel");
        return !!(panel && !panel.hasAttribute("hidden") && panel.classList.contains("panel-active"));
      }

      /* 统一的文字状态控制器：事件为主，12 秒低频校正为辅。 */
      function requestTypographyRefresh(reason, delay) {
        if (!typographyPanelIsActive()) return;
        typographyRefreshQueued = true;
        if (typographyRefreshTimer) window.clearTimeout(typographyRefreshTimer);
        typographyRefreshTimer = window.setTimeout(function () {
          var requestId = ++typographyRefreshRequestId;
          typographyRefreshTimer = 0;
          if (!typographyPanelIsActive()) return;
          /* 写入、既有读取或其他面板宿主任务占用时不丢弃刷新请求。 */
          if (typographyWriteInFlight || typographyRefreshInFlight || isBusy()) {
            requestTypographyRefresh("deferred-" + String(reason || "refresh"), 240);
            return;
          }
          typographyRefreshQueued = false;
          typographyRefreshInFlight = true;
          hostInvoke("toolsGetTypographySnapshot", { includeMixed: false }).then(function (result) {
            if (requestId !== typographyRefreshRequestId || typographyWriteInFlight) return;
            lastTextSelectionSignature = String(result && result.signature || "");
            recordTypographySnapshotPerformance(result);
            applyTypographySnapshot(result, null, true);
          }).catch(function () {
            /* 同步失败不干扰 Photoshop 原生操作；下次事件/兜底会再校正。 */
          }).then(function () {
            typographyRefreshInFlight = false;
            if (typographyRefreshQueued && typographyPanelIsActive()) requestTypographyRefresh("queued", 220);
          });
        }, Number(delay) >= 0 ? Number(delay) : 200);
      }

      function scheduleTypographyFallback() {
        if (typographyFallbackTimer) window.clearTimeout(typographyFallbackTimer);
        typographyFallbackTimer = window.setTimeout(function () {
          typographyFallbackTimer = 0;
          if (typographyPanelIsActive() && document.visibilityState !== "hidden" && !typographyWriteInFlight && !typographyRefreshInFlight) {
            requestTypographyRefresh("fallback", 0);
          }
          if (typographyPanelIsActive()) scheduleTypographyFallback();
        }, 12000);
      }

      function dispatchTypographyEvent(type, eventId) {
        if (!cs || !cs.dispatchEvent || typeof CSEvent === "undefined") return false;
        var extensionId = cs.getExtensionID ? cs.getExtensionID() : "";
        try {
          var event = new CSEvent(type, "APPLICATION", "PHXS", extensionId);
          event.data = String(eventId);
          cs.dispatchEvent(event);
          return true;
        } catch (ignoreTypographyEvent) { return false; }
      }

      function ensureTextSelectionListener() {
        textPanelVisible = typographyPanelIsActive();
        if (!textPanelVisible) return false;
        if (!typographyEventListener && cs && cs.addEventListener) {
          typographyEventName = "com.adobe.PhotoshopJSONCallback" + (cs.getExtensionID ? cs.getExtensionID() : "");
          typographyEventListener = function (event) {
            var payload;
            try { payload = JSON.parse(String(event && event.data || "").replace(/^ver1,/, "")); } catch (ignorePayload) { return; }
            var eventId = String(payload && (payload.eventID !== undefined ? payload.eventID : payload.eventId) || "");
            if (eventId === "1936483188") requestTypographyRefresh("selection-change", 200);
          };
          try { cs.addEventListener(typographyEventName, typographyEventListener); } catch (ignoreListener) { typographyEventListener = null; }
          if (typographyEventListener) dispatchTypographyEvent("com.adobe.PhotoshopRegisterEvent", "1936483188");
        }
        scheduleTypographyFallback();
        requestTypographyRefresh("panel-open", 180);
        return true;
      }

      function removeTextSelectionListener() {
        textPanelVisible = false;
        lastTextSelectionSignature = "";
        typographyRefreshRequestId += 1;
        typographyRefreshQueued = false;
        if (typographyRefreshTimer) window.clearTimeout(typographyRefreshTimer);
        if (typographyFallbackTimer) window.clearTimeout(typographyFallbackTimer);
        typographyRefreshTimer = 0;
        typographyFallbackTimer = 0;
        if (typographyEventListener && cs && cs.removeEventListener) {
          try { cs.removeEventListener(typographyEventName, typographyEventListener); } catch (ignoreRemoveListener) {}
          dispatchTypographyEvent("com.adobe.PhotoshopUnRegisterEvent", "1936483188");
        }
        typographyEventListener = null;
        typographyEventName = "";
      }

      function normalizeTextFormattingFields(fields) {
        var output = {};
        if (!fields) return output;
        if (typeof fields === "string") fields = [fields];
        (fields || []).forEach(function (field) {
          field = String(field || "");
          if (field) output[field] = true;
        });
        return output;
      }

      function markTextFormattingFields(fields) {
        var normalized = normalizeTextFormattingFields(fields);
        var hasField = false;
        Object.keys(normalized).forEach(function (field) {
          pendingTextFormattingFields[field] = true;
          hasField = true;
        });
        if (hasField) textFormattingRevision += 1;
      }

      function takePendingTextFormattingFields() {
        var fields = Object.keys(pendingTextFormattingFields);
        pendingTextFormattingFields = {};
        return fields;
      }

      function textFormattingPayload(fields, skipRead) {
        if (!skipRead) readTextConfig();
        var partial = fields && fields.length;
        var requested = normalizeTextFormattingFields(fields);
        var payload = {};
        function include(name, value) {
          if (!partial || requested[name]) payload[name] = value;
        }
        include("font", config.font);
        include("size", config.fontSize);
        include("tracking", config.tracking);
        include("leadingPoints", config.leadingPoints);
        include("align", config.textAlign);
        include("color", config.textColor);
        include("fauxBold", config.fauxBold);
        include("fauxItalic", config.fauxItalic);
        include("allCaps", config.allCaps);
        include("opticalKern", config.opticalKern);
        return payload;
      }

      function applyTextFormatting() {
        if (isBusy() || typographyWriteInFlight) return;
        typographyWriteInFlight = true;
        setBusy(true, "正在批量设置选中文字图层…");
        hostInvoke("toolsApplyTextFormatting", textFormattingPayload()).then(function (result) {
          status("文字排版完成：处理 " + result.processed + " 个，跳过 " + result.skipped + " 个非文字图层");
        }).catch(function (error) { status("文字排版失败：" + humanError(error)); }).then(function () {
          typographyWriteInFlight = false;
          setBusy(false);
          requestTypographyRefresh("write-complete", 180);
        });
      }

      function realtimeTextPayload(fields) {
        var payload = textFormattingPayload(fields, true);
        payload.realtime = true;
        return payload;
      }

      function runRealtimeTextFormatting() {
        if (!realtimeTextReady) return;
        if (isBusy() || realtimeTextBusy) {
          realtimeTextQueued = true;
          window.clearTimeout(realtimeTextTimer);
          realtimeTextTimer = window.setTimeout(runRealtimeTextFormatting, 250);
          return;
        }
        var fields = takePendingTextFormattingFields();
        if (!fields.length) return;
        realtimeTextBusy = true;
        typographyWriteInFlight = true;
        realtimeTextQueued = false;
        hostInvoke("toolsApplyTextFormatting", realtimeTextPayload(fields)).then(function (result) {
          if (!(result && result.fastPath)) {
            status("已实时更新 " + result.processed + " 个文字图层");
          }
        }).catch(function (error) { status("实时更新失败：" + humanError(error)); }).then(function () {
          realtimeTextBusy = false;
          typographyWriteInFlight = false;
          if (realtimeTextQueued || Object.keys(pendingTextFormattingFields).length) {
            scheduleRealtimeTextFormatting(260);
          } else {
            requestTypographyRefresh("write-complete", 180);
          }
        });
      }

      function scheduleRealtimeTextFormatting(delay, fields) {
        if (!realtimeTextReady) return;
        if (fields) markTextFormattingFields(fields);
        window.clearTimeout(realtimeTextTimer);
        realtimeTextTimer = window.setTimeout(runRealtimeTextFormatting, Math.max(250, Number(delay) || 300));
      }

      function readAdvancedConfig() {
        var node;
        node = $("#text-button-padding-rule"); if (node) config.textButtonPaddingRule = node.value.trim() || "28,12";
        node = $("#text-button-border"); if (node) config.textButtonBorder = node.checked;
        node = document.querySelector('input[name="text-button-corner"]:checked'); if (node) config.textButtonCorner = node.value === "1" || node.value === "rectangle" ? "1" : "0";
        node = $("#text-button-color"); if (node) config.textButtonColor = "#e53935";
        config.textButtonGroup = false;
        node = $("#words-layout-scene"); if (node) config.autoLayoutScene = Number(node.value) || 0;
        node = $("#words-layout-align"); if (node) config.autoLayoutAlign = node.value;
        node = $("#words-layout-base-gap"); if (node) config.autoLayoutBaseGap = Math.max(0, Number(node.value) || 0);
        node = $("#words-layout-auto-gap"); if (node) config.autoLayoutAutoGap = node.checked;
        node = $("#words-layout-gap-ratio"); if (node) config.autoLayoutGapRatio = node.value.trim() || "0.8:1.5";
        node = $("#words-show-quick-font"); if (node) config.showQuickFont = node.checked;
        node = $("#words-show-hierarchy"); if (node) config.showHierarchy = node.checked;
        node = $("#words-show-auto-layout"); if (node) config.showAutoLayout = node.checked;
        node = $("#words-custom-font-size"); if (node) config.fontSizePresets = parseNumberList(node.value, DEFAULT_WORDS_PRESETS.fontSize);
        node = $("#words-custom-line-space"); if (node) config.lineSpacePresets = parseNumberList(node.value, DEFAULT_WORDS_PRESETS.lineSpace);
        node = $("#words-custom-word-space"); if (node) config.wordSpacePresets = parseNumberList(node.value, DEFAULT_WORDS_PRESETS.wordSpace);
        applyWordsVisibility();
        saveConfig();
      }

      function copyTextStyle() {
        if (isBusy()) return;
        setBusy(true, "正在读取当前文字图层属性…");
        hostInvoke("toolsCopyTextStyle", {}).then(function (result) {
          config.copiedTextStyle = result.style;
          saveConfig();
          status("已复制文字属性：" + result.layerName);
        }).catch(function (error) { status("复制文字属性失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function pasteTextStyle() {
        if (isBusy()) return;
        if (!config.copiedTextStyle) return status("请先复制一个文字图层的属性");
        setBusy(true, "正在粘贴文字属性…");
        hostInvoke("toolsPasteTextStyle", { style: config.copiedTextStyle }).then(function (result) {
          status("已粘贴到 " + result.processed + " 个文字图层，跳过 " + result.skipped + " 个");
        }).catch(function (error) { status("粘贴文字属性失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function runTextStructure(action) {
        if (isBusy()) return;
        var labels = { splitLines: "拆开多行", splitChars: "词组拆开", mergeLines: "合并多行", mergeParagraph: "合并成段落" };
        setBusy(true, "正在" + labels[action] + "…");
        hostInvoke("toolsTextStructure", { action: action, order: "topdown" }).then(function (result) {
          var layoutText = action === "mergeLines"
            ? (result.layout === "horizontal" ? "，已按横向单行合并" : "，已按纵向换行合并")
            : "";
          status(labels[action] + "完成：处理 " + result.processed + " 个，生成 " + result.created + " 个图层" + layoutText);
        }).catch(function (error) { status(labels[action] + "失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function generateTextButtons(autoLevel, updateReason) {
        if (isBusy()) return;
        readAdvancedConfig();
        var rule = autoLevel ? "自动生成" + autoLevel : config.textButtonPaddingRule;
        if (autoLevel) {
          config.textButtonPaddingRule = rule;
          setNodeValue("#text-button-padding-rule", rule);
          saveConfig();
        }
        var reason = String(updateReason || "create");
        setBusy(true, reason === "create" ? "正在生成按钮背景…" : "正在修改按钮样式…");
        invokeStandaloneTextButton({
          padding: rule,
          isBorder: !!config.textButtonBorder,
          type: String(config.textButtonCorner === "1" || config.textButtonCorner === "rectangle" ? "1" : "0"),
          color: "#e53935",
          updateExisting: true
        }).then(function (result) {
          var created = Number(result.created || 0);
          var updated = Number(result.updated || 0);
          var parts = [];
          if (created) parts.push("新建 " + created + " 个");
          if (updated) parts.push("更新 " + updated + " 个");
          status("按钮处理完成：" + (parts.length ? parts.join("，") : "已处理 " + (result.processed || 0) + " 个"));
          requestTypographyRefresh("button-write-complete", 180);
        }).catch(function (error) {
          status((reason === "create" ? "生成按钮失败：" : "修改按钮样式失败：") + humanError(error));
        }).then(function () { setBusy(false); });
      }

      function runWordsAlignment(action) {
        if (isBusy()) return;
        setBusy(true, "正在对齐文字图层…");
        hostInvoke("toolsAlignLayers", { action: action }).then(function (result) {
          status("已对齐 " + (result.processed || 0) + " 个图层");
        }).catch(function (error) { status("对齐失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function runWordsDistribute(axis) {
        if (isBusy()) return;
        setBusy(true, "正在分布文字图层…");
        hostInvoke("toolsDistributeLayersEvenly", { axis: axis }).then(function (result) {
          status("已分布 " + (result.processed || 0) + " 个图层");
        }).catch(function (error) { status("分布失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function runWordsCanvas(axis) {
        if (isBusy()) return;
        setBusy(true, "正在对齐画布…");
        hostInvoke("toolsCenterLayersOnCanvas", { axis: axis }).then(function (result) {
          status("已将 " + (result.processed || 0) + " 个图层居中到画布");
        }).catch(function (error) { status("画布对齐失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function runWordsGap() {
        if (isBusy()) return;
        var expression = nodeValue("#words-gap-expression", "").trim();
        if (!expression) return status("请输入间距表达式");
        setBusy(true, "正在按自定义间距分布…");
        hostInvoke("toolsTextSpreadElement", { space: expression, direction: wordsGapDirection }).then(function (result) {
          status("已按间距分布 " + (result.processed || 0) + " 个图层");
        }).catch(function (error) { status("间距分布失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function toggleTextDirection() {
        if (isBusy()) return;
        setBusy(true, "正在切换文字方向…");
        hostInvoke("toolsToggleTextDirection", {}).then(function (result) {
          config.textDirection = result.direction || config.textDirection;
          status("已切换 " + result.processed + " 个文字图层为" + (config.textDirection === "vertical" ? "竖排" : "横排"));
        }).catch(function (error) { status("切换文字方向失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function baiduTranslatorModule() {
        return window.XinyangBaiduTranslator || null;
      }

      function normalizeTranslationLanguage(value, fallback) {
        var module = baiduTranslatorModule();
        return module && module.normalizeLanguage
          ? module.normalizeLanguage(value, fallback)
          : String(value || fallback || "");
      }

      function syncBaiduTranslationPreferences(from, to) {
        var module = baiduTranslatorModule();
        if (!module || !module.setLanguagePreferences) return;
        try {
          module.setLanguagePreferences(from, to);
        } catch (error) {}
      }

      function runTranslation() {
        if (isBusy()) return;
        var module = baiduTranslatorModule();
        if (!module || !module.translateBatch) {
          status("翻译失败：百度翻译模块未加载，请重新安装完整插件");
          return;
        }
        config.translateFrom = normalizeTranslationLanguage(nodeValue("#words-translate-from", config.translateFrom), "auto");
        config.translateTo = normalizeTranslationLanguage(nodeValue("#words-translate-to", config.translateTo), "en");
        config.translateReplace = !!($("#words-translate-replace") && $("#words-translate-replace").checked);
        syncBaiduTranslationPreferences(config.translateFrom, config.translateTo);
        saveConfig();
        setBusy(true, "正在读取选中文字…");
        hostInvoke("toolsGetSelectedTextContents", {}).then(function (result) {
          var items = result.items || [];
          if (!items.length) throw new Error("当前选择中没有文字图层");
          var texts = items.map(function (item) { return String(item.text || ""); });
          var totalCharacters = texts.reduce(function (sum, text) { return sum + text.length; }, 0);
          status("正在使用百度翻译处理 " + items.length + " 个文字图层（" + totalCharacters + " 字符）…");
          return module.translateBatch(texts, {
            sourceLanguage: config.translateFrom,
            targetLanguage: config.translateTo
          }).then(function (results) {
            if (!results || results.length !== items.length) throw new Error("百度翻译返回结果数量不一致");
            return items.map(function (item, index) {
              return { id: item.id, text: results[index].text };
            });
          });
        }).then(function (translations) {
          return hostInvoke("toolsApplyTranslatedText", { items: translations, replace: config.translateReplace });
        }).then(function (result) {
          status("百度翻译完成：处理 " + result.processed + " 个文字图层");
        }).catch(function (error) {
          status("翻译失败：" + humanError(error));
        }).then(function () { setBusy(false); });
      }

      function smartLayoutSizes() {
        var base = textPresetSizes(config.textPreset);
        var scene = Number(config.autoLayoutScene) || 0;
        var mode = Number(config.autoLayoutMode) || 0;
        var sceneScale = [1, 0.86, 0.72, 0.56][scene] || 1;
        var factors = [1, 1.18, 0.88, 0.72];
        var factor = factors[mode] || 1;
        if (mode === 3) return base.map(function () { return Math.max(1, Math.round(base[0] * sceneScale * 0.6)); });
        return base.map(function (value, index) {
          var contrast = mode === 1 ? Math.max(0.55, 1 - index * 0.08) : 1;
          return Math.max(1, Math.round(value * sceneScale * factor * contrast));
        });
      }

      function autoTextLayout() {
        if (isBusy()) return;
        readTextConfig();
        readAdvancedConfig();
        var sizes = smartLayoutSizes();
        var ratio = parseNumberList(config.autoLayoutGapRatio.replace(/:/g, ","), [0.8,1.5]);
        var gap = config.autoLayoutAutoGap ? Math.max(4, Math.round(config.fontSize * (ratio[0] || 0.8) / 3)) : config.autoLayoutBaseGap;
        setBusy(true, "正在执行一键自动排版…");
        hostInvoke("toolsAutoTextLayout", {
          sizes: sizes,
          gap: gap,
          gapRatios: ratio,
          align: config.autoLayoutAlign,
          font: config.font,
          tracking: config.tracking,
          leadingPoints: config.leadingPoints
        }).then(function (result) {
          status("自动排版完成：处理 " + result.processed + " 个文字图层");
        }).catch(function (error) { status("自动排版失败：" + humanError(error)); }).then(function () { setBusy(false); });
      }

      function renderPresetPopup(type) {
        var map = {
          "font-size": { selector: "#words-font-size-popup", values: config.fontSizePresets, format: function (v) { return v; } },
          "line-space": { selector: "#words-line-space-popup", values: config.lineSpacePresets, format: function (v) { return v + "×"; } },
          "word-space": { selector: "#words-word-space-popup", values: config.wordSpacePresets, format: function (v) { return v; } }
        };
        var item = map[type];
        if (!item) return;
        var panel = $(item.selector);
        panel.innerHTML = (item.values || []).map(function (value) { return '<button type="button" data-words-preset="' + type + '" data-value="' + value + '">' + item.format(value) + '</button>'; }).join("");
      }

      function applyWordsVisibility() {
        var quick = $("#words-quick-font-section"); if (quick) quick.style.display = config.showQuickFont === false ? "none" : "block";
        var hierarchy = $("#words-hierarchy-section"); if (hierarchy) hierarchy.style.display = config.showHierarchy === false ? "none" : "block";
        var auto = $("#words-auto-layout-toggle"); if (auto) auto.style.display = config.showAutoLayout === false ? "none" : "flex";
        var autoPanel = $("#words-auto-layout-panel"); if (autoPanel && config.showAutoLayout === false) autoPanel.setAttribute("hidden", "");
      }

      function renderRatioList() {
        var node = $("#words-layout-ratio-list");
        if (!node) return;
        var values = ["0.5:1", "0.8:1.5", "1:1", "1:2", "1:3", "1.2:2"];
        node.innerHTML = values.map(function (value) { return '<button type="button" data-layout-ratio="' + value + '">' + value + '</button>'; }).join("");
      }

      function restoreWordsUi() {
        var fontCategoryPanel = $("#words-font-category");
        if (fontCategoryPanel) fontCategoryPanel.setAttribute("hidden", "");
        setWordsDisclosureState('#words-font-tabs [data-font-filter="category"]', false);
        all("#words-font-category [data-font-category]").forEach(function (item) {
          item.classList.toggle("active", item.getAttribute("data-font-category") === String(config.fontCategory || "sans"));
        });
        var presetSelect = $("#text-preset-select");
        if (presetSelect && config.hierarchyPresets) {
          Object.keys(config.hierarchyPresets).forEach(function (key) {
            if (!Array.prototype.some.call(presetSelect.options, function (option) { return option.value === key; })) {
              var option = document.createElement("option");
              option.value = key;
              option.textContent = key.indexOf("custom") === 0 ? "自定义" + key.replace("custom", "") : key;
              presetSelect.appendChild(option);
            }
          });
        }
        setNodeValue("#tool-font-input", config.font || "");
        setNodeValue("#tool-font-search", config.fontFamily || "");
        setMetricNodeValue("#tool-font-size", config.fontSize, 0, 48);
        setMetricNodeValue("#tool-tracking", config.tracking, 0, 0);
        if (!(Number(config.leadingPoints) > 0)) config.leadingPoints = normalizeMetricNumber((Number(config.leading) || 1.2) * (Number(config.fontSize) || 48), 0, 58);
        setMetricNodeValue("#tool-leading", config.leadingPoints, 0, 58);
        setNodeValue("#tool-text-align", config.textAlign || "left");
        setNodeValue("#tool-text-color", normalizeTextColorHex(config.textColor || "#ffffff"));
        syncTextColorSwatch(config.textColor || "#ffffff");
        setNodeValue("#text-preset-select", config.textPreset || "regular");
        setNodeChecked("#words-optical-kern", config.opticalKern);
        config.textButtonCorner = config.textButtonCorner === "1" || config.textButtonCorner === "rectangle" ? "1" : "0";
        config.textButtonColor = "#e53935";
        config.textButtonGroup = false;
        setNodeChecked("#text-button-border", config.textButtonBorder);
        setNodeValue("#text-button-padding-rule", config.textButtonPaddingRule || "28,12");
        var corner = document.querySelector('input[name="text-button-corner"][value="' + config.textButtonCorner + '"]'); if (corner) corner.checked = true;
        var baiduSettings = baiduTranslatorModule() ? baiduTranslatorModule().getSettings() : null;
        if (baiduSettings) {
          config.translateFrom = normalizeTranslationLanguage(baiduSettings.sourceLanguage, "auto");
          config.translateTo = normalizeTranslationLanguage(baiduSettings.targetLanguage, "en");
        } else {
          config.translateFrom = normalizeTranslationLanguage(config.translateFrom, "auto");
          config.translateTo = normalizeTranslationLanguage(config.translateTo, "en");
        }
        setNodeValue("#words-translate-from", config.translateFrom || "auto");
        setNodeValue("#words-translate-to", config.translateTo || "en");
        setNodeChecked("#words-translate-replace", config.translateReplace !== false);
        setNodeChecked("#words-show-hierarchy", config.showHierarchy !== false);
        setNodeChecked("#words-show-auto-layout", config.showAutoLayout !== false);
        setNodeValue("#words-custom-font-size", (config.fontSizePresets || DEFAULT_WORDS_PRESETS.fontSize).join(","));
        setNodeValue("#words-custom-line-space", (config.lineSpacePresets || DEFAULT_WORDS_PRESETS.lineSpace).join(","));
        setNodeValue("#words-custom-word-space", (config.wordSpacePresets || DEFAULT_WORDS_PRESETS.wordSpace).join(","));
        setNodeValue("#words-layout-scene", config.autoLayoutScene || 0);
        setNodeValue("#words-layout-align", config.autoLayoutAlign || "left");
        setNodeValue("#words-layout-base-gap", config.autoLayoutBaseGap || 40);
        setNodeChecked("#words-layout-auto-gap", config.autoLayoutAutoGap !== false);
        setNodeValue("#words-layout-gap-ratio", config.autoLayoutGapRatio || "0.8:1.5");
        all("[data-layout-mode]").forEach(function (button) { button.classList.toggle("active", Number(button.getAttribute("data-layout-mode")) === Number(config.autoLayoutMode || 0)); });
        markTextToggle("fauxBold", config.fauxBold);
        markTextToggle("fauxItalic", config.fauxItalic);
        markTextToggle("allCaps", config.allCaps);
        markAlign(config.textAlign);
        updateFontSizeChips();
        renderHierarchyEditor();
        renderPresetPopup("font-size");
        renderPresetPopup("line-space");
        renderPresetPopup("word-space");
        renderRatioList();
        renderQuickFonts();
        applyWordsVisibility();
      }

      function normalizeWordsConfig() {
        if (!config.hierarchyPresets || typeof config.hierarchyPresets !== "object") {
          config.hierarchyPresets = { regular:[92,48,36,24,15,12], mobile:[72,50,28,20,16,10], arithmetic:[90,60,40,27,18,12], contrast:[92,50,20,15,14,12] };
        }
        if (!(config.fontSizePresets instanceof Array)) config.fontSizePresets = DEFAULT_WORDS_PRESETS.fontSize.slice(0);
        if (!(config.lineSpacePresets instanceof Array)) config.lineSpacePresets = DEFAULT_WORDS_PRESETS.lineSpace.slice(0);
        if (!(config.wordSpacePresets instanceof Array)) config.wordSpacePresets = DEFAULT_WORDS_PRESETS.wordSpace.slice(0);
        if (!(config.quickFonts instanceof Array)) config.quickFonts = [];
        if (!(config.recentFonts instanceof Array)) config.recentFonts = [];
        if (!(Number(config.leadingPoints) > 0)) config.leadingPoints = Math.round((Number(config.leading) || 1.2) * (Number(config.fontSize) || 48));
      }

      function bindTypography() {
      var typographyNav = document.querySelector('.nav-button[data-panel="typography-panel"]');
      if (typographyNav) typographyNav.addEventListener("click", function () {
        ensureTextSelectionListener();
        if (!fontsLoaded) loadFonts(true);
        else requestTypographyRefresh("panel-open", 180);
      });

      bindNode("#tool-load-fonts", "click", function (event) {
        event.stopPropagation();
        var results = $("#tool-font-results");
        var opening = !results || !results.classList.contains("open");
        if (!opening) {
          setFontResultsOpen(false);
          return;
        }
        if (fontsLoaded) openFontResultsFresh();
        else loadFonts(false, true);
      });
      bindNode("#tool-font-search", "focus", function () {
        var results = $("#tool-font-results");
        if (results && results.classList.contains("open")) return;
        if (fontsLoaded) openFontResultsFresh();
        else loadFonts(true, true);
      });
      bindNode("#tool-font-search", "input", function () {
        var query = nodeValue("#tool-font-search", "");
        if (!fontsLoaded) loadFonts(true, true, query);
        else { renderFontFamilyResults(query); setFontResultsOpen(true); }
      });
      bindNode("#tool-font-search", "keydown", function (event) {
        if (event.key === "Escape" || event.keyCode === 27) setFontResultsOpen(false);
        if (event.key === "Enter" || event.keyCode === 13) { var first = $("#words-font-result-list .text-font-result"); if (first) { event.preventDefault(); selectFontFamily(decodeURIComponent(first.getAttribute("data-font-family"))); } }
      });
      bindNode("#tool-font-results", "click", function (event) {
        var familyButton = event.target.closest("[data-font-family]");
        if (familyButton) { selectFontFamily(decodeURIComponent(familyButton.getAttribute("data-font-family"))); return; }
        var filterButton = event.target.closest("[data-font-filter]");
        if (filterButton) {
          var nextFilter = filterButton.getAttribute("data-font-filter");
          var category = $("#words-font-category");
          var categoryButton = $('#words-font-tabs [data-font-filter="category"]');
          if (nextFilter === "category") {
            var categoryOpen = false;
            if (category) {
              categoryOpen = category.hasAttribute("hidden");
              category.hidden = !categoryOpen;
              if (categoryOpen) category.removeAttribute("hidden");
              else category.setAttribute("hidden", "");
            }
            config.fontFilter = "category";
            setWordsDisclosureState(categoryButton, categoryOpen);
          } else {
            config.fontFilter = nextFilter;
            if (category) category.setAttribute("hidden", "");
            setWordsDisclosureState(categoryButton, false);
          }
          all("[data-font-filter]").forEach(function (item) { item.classList.toggle("active", item === filterButton); });
          renderFontFamilyResults(nodeValue("#tool-font-search", "")); saveConfig(); return;
        }
        var categoryButton = event.target.closest("[data-font-category]");
        if (categoryButton) {
          config.fontCategory = categoryButton.getAttribute("data-font-category");
          all("#words-font-category [data-font-category]").forEach(function (item) {
            item.classList.toggle("active", item === categoryButton);
          });
          renderFontFamilyResults(nodeValue("#tool-font-search", ""));
          saveConfig();
        }
      });
      bindNode("#tool-font-combobox", "click", function (event) { event.stopPropagation(); });
      window.addEventListener("resize", function () {
        var results = $("#tool-font-results");
        if (results && results.classList.contains("open")) positionFontResults();
      });
      document.addEventListener("click", function () { setFontResultsOpen(false); closeWordsPopovers(); });
      all("#typography-panel .words-inline-popover, #typography-panel .words-preset-popup, #typography-panel .words-floating-menu, #typography-panel .words-padding-history, #typography-panel .words-layout-ratio-list").forEach(function (node) {
        node.addEventListener("click", function (event) { event.stopPropagation(); });
      });
      bindNode("#tool-font-family", "change", function () { populateFontStyles(""); syncFontSelection(); scheduleRealtimeTextFormatting(60, "font"); });
      bindNode("#tool-font-style", "change", function () { syncFontSelection(); scheduleRealtimeTextFormatting(60, "font"); });
      all("#typography-panel .words-select-wrap > select").forEach(function (select) {
        function setSelectOpen(open) {
          var wrap = select.parentNode;
          if (wrap && wrap.classList) wrap.classList.toggle("select-open", !!open);
        }
        select.addEventListener("mousedown", function () { setSelectOpen(true); });
        select.addEventListener("focus", function () { setSelectOpen(true); });
        select.addEventListener("change", function () { setSelectOpen(false); });
        select.addEventListener("blur", function () { setSelectOpen(false); });
        select.addEventListener("keyup", function (event) { if (event.key === "Escape" || event.keyCode === 27) setSelectOpen(false); });
      });
      bindNode("#font-style-chips", "click", function (event) {
        var button = event.target.closest("button[data-font-style]"); if (!button) return;
        setNodeValue("#tool-font-style", button.getAttribute("data-font-style")); syncFontSelection(); scheduleRealtimeTextFormatting(60, "font");
      });

      bindNode("#words-read-current-style", "click", function () { readCurrentTextStyle(); });

      bindNode("#words-settings-toggle", "click", function () {
        var main = $("#words-main-view"), settings = $("#words-settings-view"), toggle = $("#words-settings-toggle");
        var showSettings = settings && settings.hasAttribute("hidden");
        if (main) toggleHidden(main, !showSettings); if (settings) toggleHidden(settings, showSettings);
        if (toggle) { toggle.classList.toggle("active", showSettings); toggle.setAttribute("aria-pressed", showSettings ? "true" : "false"); }
      });
      bindNode("#words-quick-font-selector", "click", function (event) { event.stopPropagation(); var menu=$("#words-quick-font-menu"); closeWordsPopovers(menu); toggleHidden(menu); });
      bindNode("#words-quick-font-menu", "click", function (event) {
        var remove = event.target.closest("[data-remove-quick-font]");
        if (remove) { event.stopPropagation(); config.quickFonts.splice(Number(remove.getAttribute("data-remove-quick-font")),1); config.quickFontIndex=0; renderQuickFonts(); saveConfig(); return; }
        var button = event.target.closest("[data-quick-font-index]"); if (!button) return;
        config.quickFontIndex=Number(button.getAttribute("data-quick-font-index"))||0; var item=config.quickFonts[config.quickFontIndex]; if(item) selectFontFamily(item.family); renderQuickFonts(); closeWordsPopovers(); saveConfig();
      });
      bindNode("#words-quick-weight-list", "click", function (event) {
        var button=event.target.closest("[data-quick-font-style]"); if(!button) return;
        var item=(config.quickFonts||[])[config.quickFontIndex]; if(item) { selectFontFamily(item.family); setNodeValue("#tool-font-style",button.getAttribute("data-quick-font-style")); syncFontSelection(); scheduleRealtimeTextFormatting(40, "font"); }
      });
      bindNode("#words-add-quick-font", "click", addCurrentFontToQuick);
      bindNode("#words-add-current-font", "click", addCurrentFontToQuick);

      all("[data-text-toggle]").forEach(function (button) { button.addEventListener("click", function () {
        var name=button.getAttribute("data-text-toggle"); config[name]=!config[name]; markTextToggle(name,config[name]); saveConfig(); scheduleRealtimeTextFormatting(40, name);
      }); });
      all("[data-text-align]").forEach(function (button) { button.addEventListener("click", function () {
        config.textAlign=button.getAttribute("data-text-align"); setNodeValue("#tool-text-align",config.textAlign); markAlign(config.textAlign); saveConfig(); scheduleRealtimeTextFormatting(40, "align");
      }); });
      ["tool-font-size","tool-tracking","tool-leading"].forEach(function (id) {
        ["input","change"].forEach(function (eventName) {
          bindNode("#" + id, eventName, function () {
            readTextConfig();
            if (eventName === "change") {
              if (id === "tool-font-size") setMetricNodeValue("#tool-font-size", config.fontSize, 0, 48);
              else if (id === "tool-leading") setMetricNodeValue("#tool-leading", config.leadingPoints, 0, 58);
              else setMetricNodeValue("#tool-tracking", config.tracking, 0, 0);
            }
            markChip("font-size-chips", config.fontSize);
            scheduleRealtimeTextFormatting(eventName === "input" ? 75 : 20, id === "tool-font-size" ? "size" : id === "tool-leading" ? "leadingPoints" : "tracking");
          });
        });
      });
      bindNode("#tool-text-color-picker", "click", function(event){ event.preventDefault(); event.stopPropagation(); openPhotoshopTextColorPicker(); });
      bindNode("#words-optical-kern", "change", function(){ readTextConfig(); scheduleRealtimeTextFormatting(30, "opticalKern"); });

      all("[data-preset-toggle]").forEach(function(button){ button.addEventListener("click",function(event){ event.stopPropagation(); var type=button.getAttribute("data-preset-toggle"); var panel=$(type==="font-size"?"#words-font-size-popup":type==="line-space"?"#words-line-space-popup":"#words-word-space-popup"); closeWordsPopovers(panel); var open=toggleHidden(panel); setWordsDisclosureState(button,open); }); });
      all("#typography-panel .words-preset-popup").forEach(function(panel){ panel.addEventListener("click",function(event){ var button=event.target.closest("[data-words-preset]"); if(!button)return; var type=button.getAttribute("data-words-preset"), value=Number(button.getAttribute("data-value")); if(type==="font-size"){config.fontSize=value;setMetricNodeValue("#tool-font-size", value, 0, 48);} if(type==="line-space"){config.leadingPoints=Math.round(config.fontSize*value);setMetricNodeValue("#tool-leading", config.leadingPoints, 0, 58);} if(type==="word-space"){config.tracking=value;setMetricNodeValue("#tool-tracking", value, 0, 0);} closeWordsPopovers();saveConfig();scheduleRealtimeTextFormatting(30, type==="font-size" ? "size" : type==="line-space" ? "leadingPoints" : "tracking"); }); });

      bindNode("#tool-text-copy-style", "click", copyTextStyle);
      bindNode("#tool-text-paste-style", "click", pasteTextStyle);
      bindNode("#words-structure-toggle", "click", function(event){ event.stopPropagation(); var panel=$("#words-structure-panel"); closeWordsPopovers(panel); toggleHidden(panel); });
      all("[data-text-structure]").forEach(function(button){ button.addEventListener("click",function(){ closeWordsPopovers();runTextStructure(button.getAttribute("data-text-structure")); }); });
      bindNode("#tool-text-generate-button", "click", function(){ generateTextButtons(null, "create"); });
      bindNode("#tool-text-generate-button", "contextmenu", function(event){ event.preventDefault();event.stopPropagation();var panel=$("#text-button-settings-panel");closeWordsPopovers(panel);toggleHidden(panel); });
      bindNode("#words-padding-history-toggle", "click", function(event){event.stopPropagation();var panel=$("#words-padding-history");var open=toggleHidden(panel);setWordsDisclosureState(event.currentTarget,open);});
      bindNode("#words-padding-history", "click", function(event){var button=event.target.closest("[data-padding-rule]");if(!button)return;setNodeValue("#text-button-padding-rule",button.getAttribute("data-padding-rule"));readAdvancedConfig();toggleHidden("#words-padding-history",false);setWordsDisclosureState("#words-padding-history-toggle",false);generateTextButtons(null,"padding");});
      all("[data-auto-padding]").forEach(function(button){button.addEventListener("click",function(){generateTextButtons(Number(button.getAttribute("data-auto-padding")),"padding");});});
      bindNode("#words-text-direction", "click", toggleTextDirection);

      bindNode("#words-translate-button", "click", runTranslation);
      bindNode("#words-translate-button", "contextmenu", function(event){event.preventDefault();event.stopPropagation();var panel=$("#words-translate-panel");closeWordsPopovers(panel);toggleHidden(panel);});
      bindNode("#words-translate-run", "click", function(){closeWordsPopovers();runTranslation();});
      bindNode("#words-switch-language", "click", function(){var from=normalizeTranslationLanguage(nodeValue("#words-translate-from","auto"),"auto"),to=normalizeTranslationLanguage(nodeValue("#words-translate-to","en"),"en");if(from!=="auto"){setNodeValue("#words-translate-from",to);setNodeValue("#words-translate-to",from);config.translateFrom=to;config.translateTo=from;syncBaiduTranslationPreferences(to,from);saveConfig();}});
      bindNode("#words-translate-from", "change", function(){config.translateFrom=normalizeTranslationLanguage(this.value,"auto");syncBaiduTranslationPreferences(config.translateFrom,nodeValue("#words-translate-to","en"));saveConfig();});
      bindNode("#words-translate-to", "change", function(){config.translateTo=normalizeTranslationLanguage(this.value,"en");syncBaiduTranslationPreferences(nodeValue("#words-translate-from","auto"),config.translateTo);saveConfig();});
      window.addEventListener("xinyang:baidu-settings-changed", function(event){var detail=event&&event.detail||{};config.translateFrom=normalizeTranslationLanguage(detail.sourceLanguage,"auto");config.translateTo=normalizeTranslationLanguage(detail.targetLanguage,"en");setNodeValue("#words-translate-from",config.translateFrom);setNodeValue("#words-translate-to",config.translateTo);saveConfig();});

      all("[data-words-align]").forEach(function(button){button.addEventListener("click",function(){runWordsAlignment(button.getAttribute("data-words-align"));});});
      all("[data-words-distribute]").forEach(function(button){button.addEventListener("click",function(){runWordsDistribute(button.getAttribute("data-words-distribute"));});});
      all("[data-words-canvas]").forEach(function(button){button.addEventListener("click",function(){runWordsCanvas(button.getAttribute("data-words-canvas"));});});
      all("[data-words-gap-toggle]").forEach(function(button){button.addEventListener("click",function(){wordsGapDirection=button.getAttribute("data-words-gap-toggle");var panel=$("#words-gap-panel"),title=$("#words-gap-title");if(title)title.textContent=wordsGapDirection==="vertical"?"垂直间距分布":"水平间距分布";toggleHidden(panel,true);});});
      bindNode("#words-gap-run", "click", runWordsGap);

      bindNode("#text-preset-select", "change", function(){config.textPreset=nodeValue("#text-preset-select","regular");updateFontSizeChips();renderHierarchyEditor();saveConfig();});
      bindNode("#font-size-chips", "click", function(event){var button=event.target.closest("[data-value]");if(!button)return;config.fontSize=Number(button.getAttribute("data-value"))||config.fontSize;setMetricNodeValue("#tool-font-size", config.fontSize, 0, 48);markChip("font-size-chips",config.fontSize);saveConfig();scheduleRealtimeTextFormatting(50, "size");});
      bindNode("#words-edit-hierarchy", "click", function(){renderHierarchyEditor();toggleHidden("#words-hierarchy-editor");});
      bindNode("#words-save-hierarchy", "click", function(){saveHierarchyPreset(false);});
      bindNode("#words-new-hierarchy", "click", function(){saveHierarchyPreset(true);});

      bindNode("#words-auto-layout-toggle", "click", function(){var panel=$("#words-auto-layout-panel");var open=toggleHidden(panel);setWordsDisclosureState("#words-auto-layout-toggle",open);});
      all("[data-layout-mode]").forEach(function(button){button.addEventListener("click",function(){config.autoLayoutMode=Number(button.getAttribute("data-layout-mode"))||0;all("[data-layout-mode]").forEach(function(item){item.classList.toggle("active",item===button);});saveConfig();});});
      bindNode("#words-layout-ratio-toggle", "click", function(event){event.stopPropagation();var panel=$("#words-layout-ratio-list");closeWordsPopovers(panel);var open=toggleHidden(panel);setWordsDisclosureState(event.currentTarget,open);});
      bindNode("#words-layout-ratio-list", "click", function(event){var button=event.target.closest("[data-layout-ratio]");if(!button)return;setNodeValue("#words-layout-gap-ratio",button.getAttribute("data-layout-ratio"));toggleHidden("#words-layout-ratio-list",false);setWordsDisclosureState("#words-layout-ratio-toggle",false);readAdvancedConfig();});
      bindNode("#tool-text-auto-layout", "click", autoTextLayout);

      ["#words-show-hierarchy","#words-show-auto-layout","#words-custom-font-size","#words-custom-line-space","#words-custom-word-space","#words-layout-scene","#words-layout-align","#words-layout-base-gap","#words-layout-auto-gap","#words-layout-gap-ratio"].forEach(function(selector){bindNode(selector,"change",readAdvancedConfig);});
      bindNode("#text-button-border","change",function(){readAdvancedConfig();generateTextButtons(null,"appearance");});
      bindNode("#text-button-padding-rule","change",function(){readAdvancedConfig();generateTextButtons(null,"padding");});
      bindNode("#text-button-padding-rule","keydown",function(event){if(event.key==="Enter"||event.keyCode===13){event.preventDefault();readAdvancedConfig();generateTextButtons(null,"padding");}});
      all('input[name="text-button-corner"]').forEach(function(node){node.addEventListener("change",function(){readAdvancedConfig();generateTextButtons(null,"appearance");});});
      all("[data-reset-presets]").forEach(function(button){button.addEventListener("click",function(){var key=button.getAttribute("data-reset-presets");config[key+"Presets"]=(DEFAULT_WORDS_PRESETS[key]||[]).slice(0);restoreWordsUi();saveConfig();status("已重置文字菜单预设");});});
      }

      function activateTypographyPanel() {
        lastTextSelectionSignature = "";
        ensureTextSelectionListener();
      }

      function deactivateTypographyPanel() {
        removeTextSelectionListener();
      }

      function destroyTypographyStateController() {
        removeTextSelectionListener();
        if (realtimeTextTimer) window.clearTimeout(realtimeTextTimer);
        realtimeTextTimer = null;
        realtimeTextQueued = false;
        pendingTextFormattingFields = {};
      }

      function setRealtimeReady(value) {
        realtimeTextReady = !!value;
      }

      function getTypographySnapshotPerformance() {
        return typographySnapshotPerformance;
      }

      return {
        bindTypography: bindTypography,
        normalizeWordsConfig: normalizeWordsConfig,
        restoreWordsUi: restoreWordsUi,
        readAdvancedConfig: readAdvancedConfig,
        updateFontSizeChips: updateFontSizeChips,
        ensureTextSelectionListener: ensureTextSelectionListener,
        removeTextSelectionListener: removeTextSelectionListener,
        activateTypographyPanel: activateTypographyPanel,
        deactivateTypographyPanel: deactivateTypographyPanel,
        destroy: destroyTypographyStateController,
        setRealtimeReady: setRealtimeReady,
        getTypographySnapshotPerformance: getTypographySnapshotPerformance
      };
    }
  };
}(window));
