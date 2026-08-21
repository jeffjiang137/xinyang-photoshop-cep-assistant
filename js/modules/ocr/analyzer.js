(function (global) {
  "use strict";

  if (global.XinyangOcrAnalyzer) return;

  global.XinyangOcrAnalyzer = {
    create: function (deps) {
      deps = deps || {};
    var $ = deps.$;
    var setStatus = deps.setStatus;
    var ocrRequest = deps.ocrRequest;
    var loadBase64Image = deps.loadBase64Image;
    var canvasPngBase64 = deps.canvasPngBase64;

    function normalizeOcrBox(value) {
      if (!value) return null;
      if (Array.isArray(value)) {
        if (
          value.length >= 4 &&
          !Array.isArray(value[0]) &&
          value.every(function (item) { return isFinite(Number(item)); })
        ) {
          var x = Number(value[0]);
          var y = Number(value[1]);
          var third = Number(value[2]);
          var fourth = Number(value[3]);
          if (third > x && fourth > y) {
            return { x: x, y: y, width: third - x, height: fourth - y };
          }
          return { x: x, y: y, width: third, height: fourth };
        }
        if (value.length >= 3 && Array.isArray(value[0])) {
          var xs = [];
          var ys = [];
          value.forEach(function (point) {
            if (point && point.length >= 2) {
              xs.push(Number(point[0]));
              ys.push(Number(point[1]));
            }
          });
          if (xs.length) {
            var left = Math.min.apply(Math, xs);
            var top = Math.min.apply(Math, ys);
            return {
              x: left,
              y: top,
              width: Math.max.apply(Math, xs) - left,
              height: Math.max.apply(Math, ys) - top
            };
          }
        }
        return null;
      }

      var boxX = Number(value.x != null ? value.x :
        value.left != null ? value.left : value.x1 || 0);
      var boxY = Number(value.y != null ? value.y :
        value.top != null ? value.top : value.y1 || 0);
      var width = Number(value.width != null ? value.width : value.w);
      var height = Number(value.height != null ? value.height : value.h);
      if (!isFinite(width)) {
        width = Number(value.right != null ? value.right : value.x2) - boxX;
      }
      if (!isFinite(height)) {
        height = Number(value.bottom != null ? value.bottom : value.y2) - boxY;
      }
      if (!(width > 0 && height > 0)) return null;
      return { x: boxX, y: boxY, width: width, height: height };
    }

    function normalizeHexColor(value) {
      var text = String(value || "").trim();
      if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
      if (/^#[0-9a-f]{3}$/i.test(text)) {
        return ("#" + text.charAt(1) + text.charAt(1) +
          text.charAt(2) + text.charAt(2) +
          text.charAt(3) + text.charAt(3)).toUpperCase();
      }
      return "";
    }

    function colorDistance(left, right) {
      var red = left[0] - right[0];
      var green = left[1] - right[1];
      var blue = left[2] - right[2];
      return Math.sqrt(red * red + green * green + blue * blue);
    }

    function rgbHex(rgb) {
      function component(value) {
        var text = Math.max(0, Math.min(255, Math.round(value)))
          .toString(16).toUpperCase();
        return text.length < 2 ? "0" + text : text;
      }
      return "#" + component(rgb[0]) + component(rgb[1]) + component(rgb[2]);
    }

    function quantizedColorKey(red, green, blue) {
      return [
        Math.max(0, Math.min(15, Math.round(red / 17))),
        Math.max(0, Math.min(15, Math.round(green / 17))),
        Math.max(0, Math.min(15, Math.round(blue / 17)))
      ].join(",");
    }

    function addColorSample(histogram, red, green, blue, weight) {
      var key = quantizedColorKey(red, green, blue);
      var bucket = histogram[key];
      if (!bucket) {
        bucket = histogram[key] = {
          count: 0,
          red: 0,
          green: 0,
          blue: 0
        };
      }
      weight = Number(weight) || 1;
      bucket.count += weight;
      bucket.red += red * weight;
      bucket.green += green * weight;
      bucket.blue += blue * weight;
    }

    function bucketRgb(bucket) {
      var count = Math.max(1, Number(bucket && bucket.count) || 1);
      return [
        bucket.red / count,
        bucket.green / count,
        bucket.blue / count
      ];
    }

    function dominantColor(histogram) {
      var best = null;
      var key;
      for (key in histogram) {
        if (!histogram.hasOwnProperty(key)) continue;
        if (!best || histogram[key].count > best.count) {
          best = histogram[key];
        }
      }
      return best ? bucketRgb(best) : null;
    }

    function ocrPercentile(values, percentile, fallback) {
      var numbers = (values || []).map(function (value) {
        return Number(value);
      }).filter(function (value) {
        return isFinite(value);
      }).sort(function (left, right) {
        return left - right;
      });
      if (!numbers.length) return Number(fallback) || 0;
      var position = Math.max(0, Math.min(1, Number(percentile) || 0)) *
        (numbers.length - 1);
      var lower = Math.floor(position);
      var upper = Math.ceil(position);
      if (lower === upper) return numbers[lower];
      return numbers[lower] + (numbers[upper] - numbers[lower]) *
        (position - lower);
    }

    /*
     * 文字颜色只从笔画核心像素计算。抗锯齿边缘会混入背景色，直接对
     * 整个前景直方图取主色容易把同一红字拆成多个近似颜色。先根据
     * 与背景的色差选出高对比核心，再进行量化聚类，可稳定红/蓝/白字。
     */
    function rgbLuminance(rgb) {
      rgb = rgb || [0, 0, 0];
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }

    function dominantCoreForeground(samples, contrastThreshold, background) {
      var valid = (samples || []).filter(function (sample) {
        return sample && sample.rgb && isFinite(Number(sample.distance));
      });
      if (!valid.length) return null;
      var distances = valid.map(function (sample) {
        return Number(sample.distance) || 0;
      });
      var coreThreshold = Math.max(
        Number(contrastThreshold) * 1.28,
        ocrPercentile(distances, 0.68, contrastThreshold)
      );
      var core = valid.filter(function (sample) {
        return Number(sample.distance) >= coreThreshold;
      });
      if (core.length < Math.min(4, valid.length)) core = valid;
      var histogram = {};
      core.forEach(function (sample) {
        var rgb = sample.rgb;
        var distance = Number(sample.distance) || 0;
        addColorSample(
          histogram,
          rgb[0], rgb[1], rgb[2],
          Math.pow(distance / Math.max(1, coreThreshold), 1.8)
        );
      });

      if (!background) return dominantColor(histogram);

      var backgroundLum = rgbLuminance(background);
      var best = null;
      var bestScore = -1;
      var key;
      for (key in histogram) {
        if (!histogram.hasOwnProperty(key)) continue;
        var bucket = histogram[key];
        var rgb = bucketRgb(bucket);
        var distance = colorDistance(rgb, background);
        var luminance = rgbLuminance(rgb);
        var score = Number(bucket.count) || 0;
        score *= Math.pow(distance / Math.max(1, coreThreshold), 1.55);
        if (backgroundLum <= 138) {
          score *= 0.78 + luminance / 255;
          if (luminance <= backgroundLum + 18) score *= 0.32;
        } else if (backgroundLum >= 160) {
          score *= 0.78 + (255 - luminance) / 255;
          if (luminance >= backgroundLum - 18) score *= 0.32;
        }
        if (!best || score > bestScore) {
          best = rgb;
          bestScore = score;
        }
      }
      return best || dominantColor(histogram);
    }

    /*
     * 从文字填充笔画的核心像素中再次收敛颜色。先围绕主前景色聚类，
     * 再只保留与背景色差最大的核心像素，排除抗锯齿、阴影、描边和光晕。
     */
    function refineOcrStrokeColor(samples, background, seed) {
      if (!seed || !background) return seed || null;
      var seedContrast = colorDistance(seed, background);
      var clusterDrift = Math.max(22, Math.min(72, seedContrast * 0.34));
      var candidates = (samples || []).filter(function (sample) {
        if (!sample || !sample.rgb) return false;
        return colorDistance(sample.rgb, seed) <= clusterDrift &&
          colorDistance(sample.rgb, background) >= Math.max(28, seedContrast * 0.62);
      });
      if (candidates.length < 4) return seed;

      var contrasts = candidates.map(function (sample) {
        return colorDistance(sample.rgb, background);
      });
      var coreThreshold = ocrPercentile(contrasts, 0.70, seedContrast);
      var core = candidates.filter(function (sample) {
        return colorDistance(sample.rgb, background) >= coreThreshold;
      });
      if (core.length < 3) core = candidates;

      var red = [];
      var green = [];
      var blue = [];
      core.forEach(function (sample) {
        red.push(sample.rgb[0]);
        green.push(sample.rgb[1]);
        blue.push(sample.rgb[2]);
      });
      return [
        ocrPercentile(red, 0.5, seed[0]),
        ocrPercentile(green, 0.5, seed[1]),
        ocrPercentile(blue, 0.5, seed[2])
      ];
    }


    function ocrMedian(values, fallback) {
      var numbers = (values || []).map(function (value) {
        return Number(value);
      }).filter(function (value) {
        return isFinite(value);
      }).sort(function (left, right) {
        return left - right;
      });
      if (!numbers.length) return Number(fallback) || 0;
      var middle = Math.floor(numbers.length / 2);
      return numbers.length % 2
        ? numbers[middle]
        : (numbers[middle - 1] + numbers[middle]) / 2;
    }

    function ocrMad(values, center) {
      center = isFinite(Number(center))
        ? Number(center)
        : ocrMedian(values, 0);
      return ocrMedian((values || []).map(function (value) {
        return Math.abs(Number(value) - center);
      }), 0);
    }

    function ocrAverageRgb(values) {
      var valid = (values || []).filter(function (value) {
        return value && value.length >= 3;
      });
      if (!valid.length) return null;
      var sum = [0, 0, 0];
      valid.forEach(function (value) {
        sum[0] += Number(value[0]) || 0;
        sum[1] += Number(value[1]) || 0;
        sum[2] += Number(value[2]) || 0;
      });
      return [
        sum[0] / valid.length,
        sum[1] / valid.length,
        sum[2] / valid.length
      ];
    }

    function ocrTextCharacters(text) {
      var value = String(text || "").replace(/[|丨┃¦]/g, "");
      var output = [];
      var index;
      for (index = 0; index < value.length; index += 1) {
        output.push(value.charAt(index));
      }
      return output;
    }

    function ocrCharacterWeight(character) {
      return glyphWidthWeight(String(character || ""));
    }

    function ocrTextWeightRange(characters, start, end) {
      var total = 0;
      var index;
      for (index = start; index < end; index += 1) {
        total += ocrCharacterWeight(characters[index]);
      }
      return Math.max(0.05, total);
    }

    /*
     * 根据每个视觉块的“宽度 / 字高”容量，将 OCR 字符串按连续区间分配。
     * 这里使用动态规划而不是简单按宽度百分比分割，避免第一行的大空白
     * 被错误复制到其他行，也避免窄标点、数字和英文导致字符数分配漂移。
     */
    function partitionOcrTextBySegments(text, segments) {
      var characters = ocrTextCharacters(text);
      var count = characters.length;
      var segmentCount = (segments || []).length;
      if (!segmentCount || count < segmentCount) return null;
      if (segmentCount === 1) return [characters.join("")];

      var capacities = segments.map(function (segment) {
        var width = Math.max(1, Number(segment.width) || 1);
        var height = Math.max(1, Number(segment.fontHeight || segment.height) || 1);
        return Math.max(0.18, width / height);
      });
      var capacityTotal = capacities.reduce(function (sum, value) {
        return sum + value;
      }, 0);
      var textTotal = ocrTextWeightRange(characters, 0, count);
      if (!(capacityTotal > 0 && textTotal > 0)) return null;

      var dp = [];
      var previous = [];
      var i;
      var j;
      var k;
      for (i = 0; i <= segmentCount; i += 1) {
        dp[i] = [];
        previous[i] = [];
        for (j = 0; j <= count; j += 1) {
          dp[i][j] = Infinity;
          previous[i][j] = -1;
        }
      }
      dp[0][0] = 0;

      for (i = 1; i <= segmentCount; i += 1) {
        var minimumEnd = i;
        var maximumEnd = count - (segmentCount - i);
        for (j = minimumEnd; j <= maximumEnd; j += 1) {
          var minimumStart = i - 1;
          var maximumStart = j - 1;
          for (k = minimumStart; k <= maximumStart; k += 1) {
            if (!isFinite(dp[i - 1][k])) continue;
            var partWeight = ocrTextWeightRange(characters, k, j);
            var expectedRatio = capacities[i - 1] / capacityTotal;
            var actualRatio = partWeight / textTotal;
            var ratioCost = Math.pow(actualRatio - expectedRatio, 2) * 34;
            var densityRatio = partWeight / Math.max(0.05, capacities[i - 1]);
            var densityCost = Math.pow(Math.log(Math.max(0.05, densityRatio)), 2) * 0.28;
            var wordBreakPenalty = 0;
            if (
              k > 0 &&
              /[A-Za-z0-9]/.test(characters[k - 1]) &&
              /[A-Za-z0-9]/.test(characters[k])
            ) {
              wordBreakPenalty = 0.22;
            }
            var cost = dp[i - 1][k] + ratioCost + densityCost + wordBreakPenalty;
            if (cost < dp[i][j]) {
              dp[i][j] = cost;
              previous[i][j] = k;
            }
          }
        }
      }

      if (!isFinite(dp[segmentCount][count])) return null;
      var ranges = [];
      var end = count;
      for (i = segmentCount; i > 0; i -= 1) {
        var start = previous[i][end];
        if (start < 0 || start >= end) return null;
        ranges.unshift([start, end]);
        end = start;
      }
      if (end !== 0) return null;

      return ranges.map(function (range) {
        return characters.slice(range[0], range[1]).join("").trim();
      });
    }

    function ocrColumnGapStats(activeColumns) {
      var gaps = [];
      var index;
      for (index = 1; index < activeColumns.length; index += 1) {
        var gap = activeColumns[index] - activeColumns[index - 1];
        if (gap > 0) gaps.push(gap);
      }
      var compact = gaps.filter(function (gap) {
        return gap <= ocrMedian(gaps, gap) * 3 + 2;
      });
      var median = ocrMedian(compact.length ? compact : gaps, 1);
      return {
        values: gaps,
        median: median,
        mad: ocrMad(compact.length ? compact : gaps, median)
      };
    }

    function analyzeOcrSegmentPixels(segment, imageData, canvasWidth,
        canvasHeight, scale, background, contrastThreshold) {
      var left = Math.max(0, Math.floor(Number(segment.x) * scale));
      var top = Math.max(0, Math.floor(Number(segment.y) * scale));
      var right = Math.min(
        canvasWidth,
        Math.ceil((Number(segment.x) + Number(segment.width)) * scale)
      );
      var bottom = Math.min(
        canvasHeight,
        Math.ceil((Number(segment.y) + Number(segment.height)) * scale)
      );
      var width = Math.max(1, right - left);
      var height = Math.max(1, bottom - top);
      var stride = Math.max(1, Math.floor(Math.sqrt(width * height / 7000)));
      var samples = [];
      var pixelCount = 0;
      var minX = right;
      var minY = bottom;
      var maxX = left - 1;
      var maxY = top - 1;
      var columnCounts = {};
      var data = imageData.data;
      var x;
      var y;
      var offset;
      for (y = top; y < bottom; y += stride) {
        for (x = left; x < right; x += stride) {
          offset = (y * canvasWidth + x) * 4;
          if (data[offset + 3] < 32) continue;
          var rgb = [data[offset], data[offset + 1], data[offset + 2]];
          var distance = colorDistance(rgb, background);
          if (distance < contrastThreshold) continue;
          samples.push({ rgb: rgb, distance: distance });
          pixelCount += 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          columnCounts[x] = (columnCounts[x] || 0) + 1;
        }
      }

      var foreground = dominantCoreForeground(samples, contrastThreshold, background);
      var detectedWidth = maxX >= minX
        ? (maxX - minX + stride) / scale
        : Math.max(1, Number(segment.width) || 1);
      var detectedHeight = maxY >= minY
        ? (maxY - minY + stride) / scale
        : Math.max(1, Number(segment.height) || 1);
      var normalizedArea = Math.max(
        1,
        detectedWidth * detectedHeight / Math.max(1, stride * stride / (scale * scale))
      );
      var density = Math.max(0, Math.min(1.5, pixelCount / normalizedArea));

      var activeColumns = [];
      for (x = left; x < right; x += stride) {
        if ((columnCounts[x] || 0) > 0) activeColumns.push(x);
      }
      var gaps = [];
      var index;
      for (index = 1; index < activeColumns.length; index += 1) {
        var distanceX = activeColumns[index] - activeColumns[index - 1] - stride;
        if (distanceX > 0) gaps.push(distanceX / scale);
      }

      return {
        x: maxX >= minX ? minX / scale : Number(segment.x) || 0,
        y: maxY >= minY ? minY / scale : Number(segment.y) || 0,
        width: detectedWidth,
        height: detectedHeight,
        fontHeight: detectedHeight,
        color: foreground ? rgbHex(foreground) : null,
        colorRgb: foreground,
        weightScore: density,
        letterSpacing: ocrMedian(gaps, 0),
        pixelCount: pixelCount
      };
    }

    function refineOcrCharacterBoundary(targetX, radius, columnCounts,
        minimumX, maximumX, stride) {
      var start = Math.max(minimumX + stride, Math.round(targetX - radius));
      var end = Math.min(maximumX - stride, Math.round(targetX + radius));
      var bestX = Math.round(targetX);
      var bestScore = Infinity;
      var x;
      for (x = start; x <= end; x += stride) {
        var score = Number(columnCounts[x]) || 0;
        score += Math.abs(x - targetX) / Math.max(1, radius) * 0.16;
        if (score < bestScore) {
          bestScore = score;
          bestX = x;
        }
      }
      return bestX;
    }

    function ocrMetricWindow(metrics, start, end) {
      var slice = metrics.slice(Math.max(0, start), Math.min(metrics.length, end));
      var heights = slice.map(function (item) { return item.fontHeight; });
      var weights = slice.map(function (item) { return item.weightScore; });
      var colors = slice.map(function (item) { return item.colorRgb; }).filter(function (value) {
        return value && value.length >= 3;
      });
      var averageColor = ocrAverageRgb(colors);
      var colorSpread = 0;
      if (averageColor) {
        colors.forEach(function (color) {
          colorSpread = Math.max(colorSpread, colorDistance(color, averageColor));
        });
      }
      var height = ocrMedian(heights, 0);
      var weight = ocrMedian(weights, 0);
      return {
        count: slice.length,
        height: height,
        heightMad: ocrMad(heights, height),
        weight: weight,
        weightMad: ocrMad(weights, weight),
        spacing: ocrMedian(slice.map(function (item) {
          return item.gapAfter;
        }).filter(function (value) {
          return isFinite(Number(value));
        }), 0),
        color: averageColor,
        colorSpread: colorSpread
      };
    }

    function stabilizeOcrCharacterMetrics(metrics) {
      var output = metrics || [];
      var index;
      for (index = 1; index < output.length - 1; index += 1) {
        var previous = output[index - 1];
        var current = output[index];
        var next = output[index + 1];
        if (previous.colorRgb && current.colorRgb && next.colorRgb) {
          var neighborColorDistance = colorDistance(previous.colorRgb, next.colorRgb);
          var currentPreviousDistance = colorDistance(current.colorRgb, previous.colorRgb);
          var currentNextDistance = colorDistance(current.colorRgb, next.colorRgb);
          if (
            neighborColorDistance <= 30 &&
            currentPreviousDistance >= 48 &&
            currentNextDistance >= 48
          ) {
            current.colorRgb = ocrAverageRgb([previous.colorRgb, next.colorRgb]);
            current.color = rgbHex(current.colorRgb);
          }
        }
        var neighborHeightDifference = Math.abs(previous.fontHeight - next.fontHeight) /
          Math.max(1, Math.max(previous.fontHeight, next.fontHeight));
        var currentHeightDifference = Math.min(
          Math.abs(current.fontHeight - previous.fontHeight),
          Math.abs(current.fontHeight - next.fontHeight)
        ) / Math.max(1, Math.max(current.fontHeight, previous.fontHeight, next.fontHeight));
        if (neighborHeightDifference <= 0.08 && currentHeightDifference >= 0.19) {
          current.fontHeight = ocrMedian([previous.fontHeight, next.fontHeight], current.fontHeight);
          current.height = current.fontHeight;
        }
        if (
          Math.abs(previous.weightScore - next.weightScore) <= 0.026 &&
          Math.min(
            Math.abs(current.weightScore - previous.weightScore),
            Math.abs(current.weightScore - next.weightScore)
          ) >= 0.052
        ) {
          current.weightScore = (previous.weightScore + next.weightScore) / 2;
        }
      }
      return output;
    }

    function ocrMetricToWindowDistance(metric, window, referenceHeight) {
      if (!metric || !window || !window.count) return 999;
      var colorCost = metric.colorRgb && window.color
        ? colorDistance(metric.colorRgb, window.color) / 62
        : 0;
      var heightCost = Math.abs((Number(metric.fontHeight) || 0) -
        (Number(window.height) || 0)) / Math.max(1, referenceHeight) / 0.19;
      var weightCost = Math.abs((Number(metric.weightScore) || 0) -
        (Number(window.weight) || 0)) / 0.055;
      return colorCost * 1.45 + heightCost + weightCost * 0.72;
    }

    /*
     * 两个相邻切点会产生一个孤立单字。除非两侧都有非常强的大空白或
     * 明确不同颜色证据，否则把该字归并到样式更接近的一侧，避免“制”
     * 之类因抗锯齿/笔画密度被单独创建成一个图层。
     */
    function normalizeOcrBreakCandidates(metrics, candidates) {
      var list = (candidates || []).slice().sort(function (left, right) {
        return left.index - right.index;
      });
      list = list.filter(function (candidate, index) {
        if (index && candidate.index === list[index - 1].index) return false;
        if (candidate.index === 1 || candidate.index === metrics.length - 1) {
          return !!candidate.strongIsolation;
        }
        return true;
      });

      var changed = true;
      while (changed) {
        changed = false;
        var index;
        for (index = 0; index < list.length - 1; index += 1) {
          var leftBreak = list[index];
          var rightBreak = list[index + 1];
          if (rightBreak.index - leftBreak.index !== 1) continue;
          if (leftBreak.strongIsolation && rightBreak.strongIsolation) continue;
          var singletonIndex = leftBreak.index;
          var singleton = metrics[singletonIndex];
          var referenceHeight = Math.max(
            1,
            Number(singleton && singleton.fontHeight) || 1
          );
          var leftWindow = ocrMetricWindow(
            metrics,
            Math.max(0, singletonIndex - 2),
            singletonIndex
          );
          var rightWindow = ocrMetricWindow(
            metrics,
            singletonIndex + 1,
            Math.min(metrics.length, singletonIndex + 3)
          );
          var leftDistance = ocrMetricToWindowDistance(
            singleton, leftWindow, referenceHeight
          );
          var rightDistance = ocrMetricToWindowDistance(
            singleton, rightWindow, referenceHeight
          );
          if (leftDistance <= rightDistance) list.splice(index, 1);
          else list.splice(index + 1, 1);
          changed = true;
          break;
        }
      }
      return list;
    }

    function classifyOcrWeight(weightScore, fallback, fontHeight, text) {
      var value = Number(weightScore) || 0;
      var current = String(fallback || "regular").toLowerCase();
      var height = Number(fontHeight) || 0;
      var characters = ocrTextCharacters(text);
      var length = characters.length;
      var containsCjk = /[\u3400-\u9fff\uf900-\ufaff]/.test(characters.join(""));

      /*
       * 旧阈值会把常规中文笔画密度误判为 Bold/Black，尤其是大字号标题。
       * 中文字符结构本身比拉丁字母更密，因此使用更高、更保守的阈值；
       * OCR 服务返回的字重只作为弱先验，必须同时得到像素密度支持。
       */
      if (value <= 0.001) {
        if (/black|heavy|900|800/.test(current)) return "black";
        if (/bold|semibold|700|600/.test(current)) return "bold";
        return "regular";
      }

      var blackThreshold = containsCjk ? 0.41 : 0.35;
      var boldThreshold = containsCjk ? 0.285 : 0.235;
      if (height < 18) {
        blackThreshold += 0.035;
        boldThreshold += 0.025;
      }
      if (length <= 1) {
        blackThreshold += 0.045;
        boldThreshold += 0.035;
      }

      if (/black|heavy|900|800/.test(current)) {
        if (value >= blackThreshold * 0.92) return "black";
        if (value >= boldThreshold * 0.94) return "bold";
        return "regular";
      }
      if (/bold|semibold|700|600/.test(current)) {
        return value >= boldThreshold * 0.88 ? "bold" : "regular";
      }
      if (length >= 2 && value >= blackThreshold) return "black";
      if (length >= 2 && value >= boldThreshold) return "bold";
      return "regular";
    }

    function splitVisualSegmentByStyle(segment, text, line, imageData,
        canvasWidth, canvasHeight, scale, background, contrastThreshold,
        columnCounts, minColumnX, maxColumnX, stride) {
      var characters = ocrTextCharacters(text);
      if (characters.length < 2) {
        segment.text = characters.join("");
        return [segment];
      }

      var weights = characters.map(ocrCharacterWeight);
      var totalWeight = weights.reduce(function (sum, value) {
        return sum + value;
      }, 0);
      var segmentLeft = Number(segment.x) * scale;
      var segmentRight = (Number(segment.x) + Number(segment.width)) * scale;
      var segmentHeight = Math.max(1, Number(segment.fontHeight || segment.height) * scale);
      var boundaries = [segmentLeft];
      var cumulative = 0;
      var index;
      for (index = 0; index < characters.length - 1; index += 1) {
        cumulative += weights[index];
        var target = segmentLeft + (segmentRight - segmentLeft) * cumulative /
          Math.max(0.1, totalWeight);
        boundaries.push(refineOcrCharacterBoundary(
          target,
          Math.max(stride * 2, segmentHeight * 0.24),
          columnCounts,
          Math.max(minColumnX, Math.floor(segmentLeft)),
          Math.min(maxColumnX, Math.ceil(segmentRight)),
          stride
        ));
      }
      boundaries.push(segmentRight);

      for (index = 1; index < boundaries.length; index += 1) {
        if (boundaries[index] <= boundaries[index - 1] + stride) {
          boundaries[index] = boundaries[index - 1] + stride;
        }
      }
      boundaries[boundaries.length - 1] = Math.max(
        boundaries[boundaries.length - 1],
        boundaries[boundaries.length - 2] + stride
      );

      var metrics = [];
      for (index = 0; index < characters.length; index += 1) {
        var left = boundaries[index] / scale;
        var right = boundaries[index + 1] / scale;
        var metric = analyzeOcrSegmentPixels({
          x: left,
          y: segment.y,
          width: Math.max(1, right - left),
          height: segment.height
        }, imageData, canvasWidth, canvasHeight, scale,
        background, contrastThreshold);
        metric.character = characters[index];
        metric.slotLeft = left;
        metric.slotRight = right;
        metric.gapAfter = null;
        metrics.push(metric);
      }
      for (index = 0; index < metrics.length - 1; index += 1) {
        metrics[index].gapAfter = Math.max(
          0,
          metrics[index + 1].x - (metrics[index].x + metrics[index].width)
        );
      }
      stabilizeOcrCharacterMetrics(metrics);

      var allGaps = metrics.slice(0, -1).map(function (item) {
        return Number(item.gapAfter) || 0;
      });
      var normalGap = ocrMedian(allGaps, 0);
      var gapMad = ocrMad(allGaps, normalGap);
      var candidates = [];
      for (index = 0; index < metrics.length - 1; index += 1) {
        var leftWindow = ocrMetricWindow(metrics, Math.max(0, index - 1), index + 1);
        var rightWindow = ocrMetricWindow(metrics, index + 1, Math.min(metrics.length, index + 3));
        var referenceHeight = Math.max(
          1,
          ocrMedian([leftWindow.height, rightWindow.height], segment.fontHeight || segment.height)
        );
        var colorDifference = leftWindow.color && rightWindow.color
          ? colorDistance(leftWindow.color, rightWindow.color)
          : 0;
        var heightDifference = Math.abs(leftWindow.height - rightWindow.height) /
          Math.max(1, Math.max(leftWindow.height, rightWindow.height));
        var weightDifference = Math.abs(leftWindow.weight - rightWindow.weight) /
          Math.max(0.04, Math.max(leftWindow.weight, rightWindow.weight));
        var gap = Number(metrics[index].gapAfter) || 0;
        var gapBreak = gap > Math.max(
          referenceHeight * 0.62,
          normalGap + Math.max(referenceHeight * 0.18, gapMad * 3.2)
        );
        var spacingBreak = false;
        if (index >= 2 && index + 2 < metrics.length) {
          var leftGaps = allGaps.slice(Math.max(0, index - 2), index);
          var rightGaps = allGaps.slice(index + 1, Math.min(allGaps.length, index + 3));
          if (leftGaps.length >= 2 && rightGaps.length >= 2) {
            var leftSpacing = ocrMedian(leftGaps, 0);
            var rightSpacing = ocrMedian(rightGaps, 0);
            spacingBreak = Math.abs(leftSpacing - rightSpacing) > referenceHeight * 0.12 &&
              Math.max(leftSpacing, rightSpacing) /
                Math.max(1, Math.min(leftSpacing, rightSpacing)) >= 1.75;
          }
        }
        var stableSides = leftWindow.count >= 2 && rightWindow.count >= 2;
        var stableColorSides = stableSides &&
          leftWindow.colorSpread <= 36 && rightWindow.colorSpread <= 36;
        var stableHeightSides = stableSides &&
          leftWindow.heightMad <= referenceHeight * 0.08 &&
          rightWindow.heightMad <= referenceHeight * 0.08;
        var stableWeightSides = stableSides &&
          leftWindow.weightMad <= 0.032 && rightWindow.weightMad <= 0.032;
        var colorBreak = colorDifference >= 52 && stableColorSides;
        var sizeBreak = heightDifference >= 0.19 &&
          Math.abs(leftWindow.height - rightWindow.height) >= 2 &&
          stableHeightSides;
        var weightBreak = weightDifference >= 0.38 &&
          Math.abs(leftWindow.weight - rightWindow.weight) >= 0.052 &&
          stableWeightSides;

        /*
         * 单个汉字的笔画数量会让局部前景密度显著波动，不能仅凭
         * weightBreak 就拆层。例如“企业标识、品牌文字”会被错误切成
         * 多个图层。字重差必须同时有间距、颜色或字号证据才可作为切点。
         */
        var supportedWeightBreak = weightBreak && (
          gapBreak || spacingBreak || colorDifference >= 42 || sizeBreak
        );
        if (gapBreak || spacingBreak || colorBreak || sizeBreak || supportedWeightBreak) {
          candidates.push({
            index: index + 1,
            gapBreak: gapBreak,
            spacingBreak: spacingBreak,
            colorBreak: colorBreak,
            sizeBreak: sizeBreak,
            weightBreak: supportedWeightBreak,
            colorDifference: colorDifference,
            heightDifference: heightDifference,
            strongIsolation: gap > referenceHeight * 0.95 ||
              (colorDifference >= 92 && stableColorSides) ||
              (heightDifference >= 0.38 && stableHeightSides)
          });
        }
      }

      candidates = normalizeOcrBreakCandidates(metrics, candidates);
      var breakIndexes = candidates.map(function (candidate) {
        return candidate.index;
      });
      if (!breakIndexes.length) {
        var wholeMetric = analyzeOcrSegmentPixels(segment, imageData,
          canvasWidth, canvasHeight, scale, background, contrastThreshold);
        segment.text = characters.join("");
        segment.color = wholeMetric.color || segment.color || line.color;
        segment.fontHeight = wholeMetric.fontHeight || segment.fontHeight;
        segment.weightScore = wholeMetric.weightScore;
        segment.letterSpacing = normalGap;
        segment.weight = classifyOcrWeight(
          wholeMetric.weightScore, line.weight, segment.fontHeight, segment.text
        );
        return [segment];
      }

      var starts = [0].concat(breakIndexes);
      var ends = breakIndexes.concat([characters.length]);
      var output = [];
      for (index = 0; index < starts.length; index += 1) {
        var startIndex = starts[index];
        var endIndex = ends[index];
        var leftMetric = metrics[startIndex];
        var rightMetric = metrics[endIndex - 1];
        var runLeft = leftMetric.slotLeft;
        var runRight = rightMetric.slotRight;
        var runMetric = analyzeOcrSegmentPixels({
          x: runLeft,
          y: segment.y,
          width: Math.max(1, runRight - runLeft),
          height: segment.height
        }, imageData, canvasWidth, canvasHeight, scale,
        background, contrastThreshold);
        var runText = characters.slice(startIndex, endIndex).join("");
        output.push({
          x: runLeft,
          y: isFinite(Number(runMetric.y))
            ? Number(runMetric.y)
            : Number(segment.y) || 0,
          width: Math.max(1, runRight - runLeft),
          height: Math.max(
            1,
            Number(runMetric.height) || Number(segment.height) || 1
          ),
          fontHeight: runMetric.fontHeight || segment.fontHeight,
          color: runMetric.color || segment.color || line.color,
          weightScore: runMetric.weightScore,
          weight: classifyOcrWeight(
            runMetric.weightScore, line.weight,
            runMetric.fontHeight || segment.fontHeight, runText
          ),
          letterSpacing: ocrMedian(
            metrics.slice(startIndex, Math.max(startIndex, endIndex - 1)).map(function (item) {
              return item.gapAfter;
            }),
            0
          ),
          text: runText,
          styleSplit: true
        });
      }
      return output;
    }

    function enhanceOcrVisualSegments(line, imageData, canvasWidth,
        canvasHeight, scale, background, contrastThreshold, columnCounts,
        minX, maxX, stride) {
      if (!line || !line.box) return line;
      var baseSegments = line.visualTextSegments && line.visualTextSegments.length
        ? line.visualTextSegments.slice()
        : [{
            x: line.box.x,
            y: line.box.y,
            width: line.box.width,
            height: line.box.height
          }];
      baseSegments.sort(function (left, right) {
        return left.x - right.x;
      });
      var parts = partitionOcrTextBySegments(line.text, baseSegments);
      if (!parts || parts.length !== baseSegments.length) {
        parts = [String(line.text || "").replace(/[|丨┃¦]/g, "")];
        baseSegments = [{
          x: line.box.x,
          y: line.box.y,
          width: line.box.width,
          height: line.box.height
        }];
      }

      var expanded = [];
      baseSegments.forEach(function (segment, index) {
        var metric = analyzeOcrSegmentPixels(segment, imageData,
          canvasWidth, canvasHeight, scale, background, contrastThreshold);
        segment.fontHeight = metric.fontHeight || segment.height;
        segment.color = metric.color || line.color;
        segment.weightScore = metric.weightScore;
        segment.letterSpacing = metric.letterSpacing;
        splitVisualSegmentByStyle(
          segment,
          parts[index],
          line,
          imageData,
          canvasWidth,
          canvasHeight,
          scale,
          background,
          contrastThreshold,
          columnCounts,
          minX,
          maxX,
          stride
        ).forEach(function (part) {
          if (String(part.text || "").trim()) expanded.push(part);
        });
      });

      if (!expanded.length) return line;
      var weightScores = expanded.map(function (part) {
        return Number(part.weightScore) || 0;
      }).filter(function (value) {
        return value > 0;
      });
      var minimumWeight = weightScores.length
        ? Math.min.apply(Math, weightScores)
        : 0;
      var maximumWeight = weightScores.length
        ? Math.max.apply(Math, weightScores)
        : 0;
      var meaningfulWeightSplit = weightScores.length > 1 &&
        maximumWeight / Math.max(0.04, minimumWeight) >= 1.34 &&
        maximumWeight - minimumWeight >= 0.045;
      expanded.forEach(function (part) {
        if (meaningfulWeightSplit) {
          part.weight = Number(part.weightScore) >=
            (minimumWeight + maximumWeight) / 2
              ? classifyOcrWeight(
                  part.weightScore, "bold", part.fontHeight, part.text
                )
              : "regular";
        } else {
          part.weight = classifyOcrWeight(
            part.weightScore, line.weight, part.fontHeight, part.text
          );
        }
        part.fontStyle = line.fontStyle;
        part.fontFamily = line.fontFamily;
      });

      if (expanded.length === 1) {
        line.color = expanded[0].color || line.color;
        line.fontHeight = expanded[0].fontHeight || line.fontHeight;
        line.weightScore = expanded[0].weightScore;
        line.weight = expanded[0].weight || line.weight;
        line.letterSpacing = expanded[0].letterSpacing;
        line.visualTextSegments = null;
        return line;
      }
      line.visualTextSegments = expanded;
      return line;
    }

    /*
     * OCR 框有时会把“图标 + 短语”或“短语 + 竖向分隔线”一起包住。
     * 如果直接把整个框宽交给 Photoshop，短语会用很大的 tracking
     * 铺满图标占位。这里根据前景列的宽空隙找出最符合文字自然宽度的
     * 连续像素簇，只收紧横向范围；纵向仍沿用真实前景高度。
     */
    function tightenOcrBoxToTextCluster(line, columnCounts, minX, maxX,
        minY, maxY, stride, scale) {
      var text = String(line && line.text || "").trim();
      if (!line || !line.box || text.length < 2 || maxX < minX || maxY < minY) {
        return false;
      }

      var detectedHeight = Math.max(stride, maxY - minY + stride);
      var minimumColumnPixels = Math.max(
        1,
        Math.round(detectedHeight / Math.max(1, stride) * 0.012)
      );
      var activeColumns = [];
      var x;
      for (x = minX; x <= maxX; x += stride) {
        if ((columnCounts[x] || 0) >= minimumColumnPixels) {
          activeColumns.push(x);
        }
      }
      if (activeColumns.length < 2) {
        line.visualTextSegments = null;
        return false;
      }

      var gapStats = ocrColumnGapStats(activeColumns);
      var splitGap = Math.max(
        stride * 4,
        Math.round(detectedHeight * 0.62),
        Math.round(gapStats.median * 3.5 + gapStats.mad * 2)
      );
      var segments = [];
      var current = {
        left: activeColumns[0],
        right: activeColumns[0],
        pixels: Number(columnCounts[activeColumns[0]]) || 0
      };
      var index;
      for (index = 1; index < activeColumns.length; index += 1) {
        x = activeColumns[index];
        var emptyGap = x - current.right - stride;
        if (emptyGap > splitGap) {
          segments.push(current);
          current = {
            left: x,
            right: x,
            pixels: Number(columnCounts[x]) || 0
          };
        } else {
          current.right = x;
          current.pixels += Number(columnCounts[x]) || 0;
        }
      }
      segments.push(current);

      var minimumSegmentWidth = Math.max(stride * 2, detectedHeight * 0.22);
      segments = segments.filter(function (segment) {
        return segment.right - segment.left + stride >= minimumSegmentWidth &&
          segment.pixels >= 3;
      });

      if (segments.length < 2) {
        line.visualTextSegments = null;
        return false;
      }

      var visualSegments = segments.map(function (segment) {
        return {
          x: segment.left / scale,
          y: minY / scale,
          width: Math.max(1, (segment.right - segment.left + stride) / scale),
          height: Math.max(1, detectedHeight / scale)
        };
      });
      var partition = partitionOcrTextBySegments(text, visualSegments);
      if (!partition || partition.some(function (part) {
        return !String(part || "").trim();
      })) {
        line.visualTextSegments = null;
        return false;
      }

      visualSegments.forEach(function (segment, segmentIndex) {
        segment.text = partition[segmentIndex];
      });
      line.visualTextSegments = visualSegments;
      return true;
    }

    /*
     * OCR 通常只可靠返回文字与坐标，不返回字体颜色。旧版在颜色缺失时
     * 直接回退黑色，导致白字稳定生成成黑字。这里从导出的原图中按文字框
     * 采样：边缘主色作为背景，再选择与背景反差大且像素数量足够的颜色
     * 作为文字色，同时以这些前景像素收紧字框高度，减少 OCR 框高波动。
     */
    function medianPositive(values, fallback) {
      return ocrMedian((values || []).filter(function (value) {
        return isFinite(Number(value)) && Number(value) > 0;
      }), fallback);
    }

    function explicitOcrFontStyle(line) {
      var token = String(line && line.fontFamily || "").toLowerCase();
      if (/serif|song|simsun|宋|明朝|mincho|source.?han.?serif|noto.?serif/.test(token)) {
        return "serif";
      }
      if (/sans|hei|黑|gothic|雅黑|source.?han.?sans|noto.?sans|arial|impact/.test(token)) {
        return "sans";
      }
      return "";
    }

    /*
     * 按单个中文字符的字框分别测量横、竖笔画厚度。
     * - 竖笔画厚度：统计每一行中的短横向连续像素宽度；
     * - 横笔画厚度：统计每一列中的短纵向连续像素高度。
     * 黑体横竖接近，宋体通常竖笔明显粗于横笔。只有样本量和置信度
     * 足够时才覆盖 OCR 字体分类，单个汉字也可以参与判断。
     */
    function ocrCharacterPixelSlots(text, box) {
      var characters = ocrTextCharacters(text);
      var totalWeight = ocrTextWeightRange(characters, 0, characters.length);
      var cursor = Number(box.x) || 0;
      var output = [];
      characters.forEach(function (character) {
        var weight = ocrCharacterWeight(character);
        var width = Math.max(1, Number(box.width) * weight / totalWeight);
        output.push({ character: character, x: cursor, width: width });
        cursor += width;
      });
      return output;
    }

    function measureOcrCharacterStrokes(slot, box, imageData, canvasWidth,
        canvasHeight, scale, background, foreground, contrastThreshold) {
      if (!/[\u3400-\u9fff\uf900-\ufaff]/.test(slot.character)) return null;
      var padX = Math.max(0, slot.width * 0.06);
      var left = Math.max(0, Math.floor((slot.x + padX) * scale));
      var right = Math.min(canvasWidth, Math.ceil((slot.x + slot.width - padX) * scale));
      var top = Math.max(0, Math.floor((Number(box.y) || 0) * scale));
      var bottom = Math.min(canvasHeight, Math.ceil(((Number(box.y) || 0) +
        (Number(box.height) || 1)) * scale));
      var width = right - left;
      var height = bottom - top;
      if (width < 8 || height < 8) return null;

      var stride = Math.max(1, Math.floor(Math.sqrt(width * height / 9000)));
      var cols = Math.max(1, Math.ceil(width / stride));
      var rows = Math.max(1, Math.ceil(height / stride));
      var mask = [];
      var data = imageData.data;
      var foregroundContrast = colorDistance(foreground, background);
      var minimumContrast = Math.max(Number(contrastThreshold) || 38,
        foregroundContrast * 0.56);
      var maximumColorDrift = Math.max(30, Math.min(82, foregroundContrast * 0.42));
      var activeCount = 0;
      var row;
      var col;
      for (row = 0; row < rows; row += 1) {
        mask[row] = [];
        var y = Math.min(bottom - 1, top + row * stride);
        for (col = 0; col < cols; col += 1) {
          var x = Math.min(right - 1, left + col * stride);
          var offset = (y * canvasWidth + x) * 4;
          var rgb = [data[offset], data[offset + 1], data[offset + 2]];
          var active = data[offset + 3] >= 32 &&
            colorDistance(rgb, background) >= minimumContrast &&
            colorDistance(rgb, foreground) <= maximumColorDrift;
          mask[row][col] = active;
          if (active) activeCount += 1;
        }
      }
      if (activeCount < Math.max(18, rows + cols)) return null;

      var maximumThickness = Math.max(2, Math.round(Math.min(rows, cols) * 0.30));
      var verticalStrokeWidths = [];
      var horizontalStrokeHeights = [];
      for (row = 0; row < rows; row += 1) {
        var run = 0;
        for (col = 0; col <= cols; col += 1) {
          if (col < cols && mask[row][col]) run += 1;
          else if (run) {
            if (run <= maximumThickness) verticalStrokeWidths.push(run * stride / scale);
            run = 0;
          }
        }
      }
      for (col = 0; col < cols; col += 1) {
        var verticalRun = 0;
        for (row = 0; row <= rows; row += 1) {
          if (row < rows && mask[row][col]) verticalRun += 1;
          else if (verticalRun) {
            if (verticalRun <= maximumThickness) horizontalStrokeHeights.push(verticalRun * stride / scale);
            verticalRun = 0;
          }
        }
      }
      if (verticalStrokeWidths.length < 5 || horizontalStrokeHeights.length < 5) {
        return null;
      }

      var verticalThickness = ocrPercentile(verticalStrokeWidths, 0.58, 1);
      var horizontalThickness = ocrPercentile(horizontalStrokeHeights, 0.58, 1);
      return {
        verticalThickness: verticalThickness,
        horizontalThickness: horizontalThickness,
        ratio: verticalThickness / Math.max(0.5, horizontalThickness),
        samples: Math.min(verticalStrokeWidths.length, horizontalStrokeHeights.length),
        density: activeCount / Math.max(1, rows * cols)
      };
    }

    function inferOcrFontStyleFromPixels(line, imageData, canvasWidth,
        canvasHeight, scale, background, foreground, contrastThreshold) {
      if (!line || !line.box || !background || !foreground) return null;
      var slots = ocrCharacterPixelSlots(String(line.text || ""), line.box);
      var measurements = [];
      slots.forEach(function (slot) {
        var metric = measureOcrCharacterStrokes(
          slot, line.box, imageData, canvasWidth, canvasHeight, scale,
          background, foreground, contrastThreshold
        );
        if (metric) measurements.push(metric);
      });
      if (!measurements.length) return null;

      var ratios = measurements.map(function (metric) { return metric.ratio; });
      var verticals = measurements.map(function (metric) { return metric.verticalThickness; });
      var horizontals = measurements.map(function (metric) { return metric.horizontalThickness; });
      var ratio = ocrMedian(ratios, 1);
      var single = measurements.length === 1;
      var serifThreshold = single ? 1.31 : 1.23;
      var sansThreshold = single ? 1.09 : 1.14;
      var style = "";
      var confidence = 0;
      if (ratio >= serifThreshold) {
        style = "serif";
        confidence = Math.min(0.98, 0.62 +
          (ratio - serifThreshold) * 1.45 + measurements.length * 0.045);
      } else if (ratio <= sansThreshold) {
        style = "sans";
        confidence = Math.min(0.98, 0.62 +
          (sansThreshold - ratio) * 1.6 + measurements.length * 0.045);
      }
      return {
        style: style,
        confidence: confidence,
        ratio: ratio,
        verticalThickness: ocrMedian(verticals, 1),
        horizontalThickness: ocrMedian(horizontals, 1),
        characterSamples: measurements.length
      };
    }

    function analyzeOcrLineAppearance(line, imageData, canvasWidth, canvasHeight,
        scale) {
      var box = line && line.box ? line.box : null;
      if (!box) return line;
      var left = Math.max(0, Math.floor(box.x * scale));
      var top = Math.max(0, Math.floor(box.y * scale));
      var right = Math.min(
        canvasWidth,
        Math.ceil((box.x + box.width) * scale)
      );
      var bottom = Math.min(
        canvasHeight,
        Math.ceil((box.y + box.height) * scale)
      );
      var width = right - left;
      var height = bottom - top;
      if (width < 2 || height < 2) {
        if (!line.color) line.color = "#111111";
        return line;
      }

      var data = imageData.data;
      var backgroundHistogram = {};
      var border = Math.max(1, Math.min(3, Math.round(
        Math.min(width, height) * 0.08
      )));
      var area = width * height;
      var stride = Math.max(1, Math.floor(Math.sqrt(area / 12000)));
      var x;
      var y;
      var offset;
      var red;
      var green;
      var blue;
      var alpha;

      for (y = top; y < bottom; y += stride) {
        for (x = left; x < right; x += stride) {
          if (
            x >= left + border && x < right - border &&
            y >= top + border && y < bottom - border
          ) continue;
          offset = (y * canvasWidth + x) * 4;
          alpha = data[offset + 3];
          if (alpha < 32) continue;
          addColorSample(
            backgroundHistogram,
            data[offset],
            data[offset + 1],
            data[offset + 2],
            1
          );
        }
      }

      var background = dominantColor(backgroundHistogram);
      if (!background) {
        if (!line.color) line.color = "#111111";
        return line;
      }

      var foregroundSamples = [];
      var contrastThreshold = 38;
      for (y = top; y < bottom; y += stride) {
        for (x = left; x < right; x += stride) {
          offset = (y * canvasWidth + x) * 4;
          alpha = data[offset + 3];
          if (alpha < 32) continue;
          red = data[offset];
          green = data[offset + 1];
          blue = data[offset + 2];
          var distance = colorDistance([red, green, blue], background);
          if (distance < contrastThreshold) continue;
          foregroundSamples.push({
            rgb: [red, green, blue],
            distance: distance
          });
        }
      }

      var bestForeground = dominantCoreForeground(
        foregroundSamples, contrastThreshold, background
      );
      bestForeground = refineOcrStrokeColor(
        foregroundSamples, background, bestForeground
      );

      if (!bestForeground) {
        if (!line.color) line.color = "#111111";
        return line;
      }

      /*
       * 服务明确返回颜色时仍以原图采样为准，但只有采样颜色与背景形成
       * 足够反差才覆盖，避免渐变背景中的偶发噪点替换可靠服务结果。
       */
      var foregroundContrast = colorDistance(bestForeground, background);
      if (foregroundContrast >= 52 || !line.color) {
        line.color = rgbHex(bestForeground);
        line.colorSource = "image";
      }
      if (!line.color) line.color = "#111111";

      var explicitStyle = explicitOcrFontStyle(line);
      var inferredStyle = inferOcrFontStyleFromPixels(
        line,
        imageData,
        canvasWidth,
        canvasHeight,
        scale,
        background,
        bestForeground,
        contrastThreshold
      );
      if (inferredStyle && inferredStyle.style &&
          inferredStyle.confidence >= 0.62) {
        line.fontStyle = inferredStyle.style;
        line.fontStyleSource = "image-strokes";
        line.fontStyleConfidence = inferredStyle.confidence;
        line.strokeRatio = inferredStyle.ratio;
        line.verticalStrokeThickness = inferredStyle.verticalThickness;
        line.horizontalStrokeThickness = inferredStyle.horizontalThickness;
      } else if (explicitStyle) {
        line.fontStyle = explicitStyle;
      }

      var axis = [
        bestForeground[0] - background[0],
        bestForeground[1] - background[1],
        bestForeground[2] - background[2]
      ];
      var axisLengthSquared =
        axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];
      var minX = right;
      var minY = bottom;
      var maxX = left - 1;
      var maxY = top - 1;
      var rowCounts = {};
      var columnCounts = {};

      if (axisLengthSquared > 1) {
        for (y = top; y < bottom; y += stride) {
          for (x = left; x < right; x += stride) {
            offset = (y * canvasWidth + x) * 4;
            if (data[offset + 3] < 32) continue;
            red = data[offset];
            green = data[offset + 1];
            blue = data[offset + 2];
            /*
             * 文字可能在同一 OCR 框内包含多种颜色。不能只沿主文字色轴
             * 取前景，否则第二种颜色会消失，后续也无法按颜色拆分。
             */
            if (colorDistance([red, green, blue], background) <
                contrastThreshold) continue;
            rowCounts[y] = (rowCounts[y] || 0) + 1;
            columnCounts[x] = (columnCounts[x] || 0) + 1;
          }
        }

        var minimumRowPixels = Math.max(
          1,
          Math.round(width / Math.max(1, stride) * 0.012)
        );
        var minimumColumnPixels = Math.max(
          1,
          Math.round(height / Math.max(1, stride) * 0.012)
        );
        for (y = top; y < bottom; y += stride) {
          if ((rowCounts[y] || 0) >= minimumRowPixels) {
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
        for (x = left; x < right; x += stride) {
          if ((columnCounts[x] || 0) >= minimumColumnPixels) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
          }
        }
      }

      if (
        maxY >= minY && maxX >= minX &&
        Math.abs(Number(line.angle) || 0) < 3
      ) {
        var detectedWidth = (maxX - minX + stride) / scale;
        var detectedHeight = (maxY - minY + stride) / scale;
        var widthRatio = detectedWidth / Math.max(1, box.width);
        var heightRatio = detectedHeight / Math.max(1, box.height);
        if (
          widthRatio >= 0.25 && widthRatio <= 1.08 &&
          heightRatio >= 0.38 && heightRatio <= 1.08
        ) {
          var padding = Math.max(0.5, 0.75 / scale);
          line.box = {
            x: Math.max(0, minX / scale - padding),
            y: Math.max(0, minY / scale - padding),
            width: Math.max(1, detectedWidth + padding * 2),
            height: Math.max(1, detectedHeight + padding * 2)
          };
          line.fontSize = 0;
          line.boxSource = "image";
        }
        tightenOcrBoxToTextCluster(
          line,
          columnCounts,
          minX,
          maxX,
          minY,
          maxY,
          stride,
          scale
        );
        if (!line.tableLayout) {
          enhanceOcrVisualSegments(
            line,
            imageData,
            canvasWidth,
            canvasHeight,
            scale,
            background,
            contrastThreshold,
            columnCounts,
            minX,
            maxX,
            stride
          );
        } else {
          line.visualTextSegments = null;
        }
      }
      return line;
    }

    function analyzeOcrAppearance(lines, imageBase64) {
      return new Promise(function (resolve) {
        var items = lines || [];

        function applyFallback() {
          items.forEach(function (line) {
            if (!line.color) line.color = "#111111";
          });
        }

        if (!imageBase64 || typeof Image === "undefined") {
          applyFallback();
          resolve(items);
          return;
        }

        var image = new Image();
        image.onload = function () {
          var canvas = null;
          var pixels = null;
          var scale = 1;
          try {
            var sourceWidth = Math.max(1, Number(image.naturalWidth || image.width));
            var sourceHeight = Math.max(1, Number(image.naturalHeight || image.height));
            var maximumPixels = 12000000;
            scale = Math.min(
              1,
              Math.sqrt(maximumPixels / Math.max(1, sourceWidth * sourceHeight))
            );
            canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(sourceWidth * scale));
            canvas.height = Math.max(1, Math.round(sourceHeight * scale));
            var context = canvas.getContext("2d");
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          } catch (error) {
            applyFallback();
            resolve(items);
            return;
          }

          var lineIndex = 0;
          function releaseAndResolve() {
            pixels = null;
            try {
              canvas.width = 1;
              canvas.height = 1;
              image.onload = null;
              image.onerror = null;
              image.src = "";
            } catch (ignoreOcrCanvasRelease) {}
            resolve(items);
          }

          function processAppearanceChunk() {
            var startedAt = Date.now ? Date.now() : new Date().getTime();
            var processed = 0;
            while (lineIndex < items.length && processed < 4) {
              try {
                analyzeOcrLineAppearance(
                  items[lineIndex],
                  pixels,
                  canvas.width,
                  canvas.height,
                  scale
                );
              } catch (lineError) {
                if (!items[lineIndex].color) items[lineIndex].color = "#111111";
              }
              lineIndex += 1;
              processed += 1;
              var now = Date.now ? Date.now() : new Date().getTime();
              if (now - startedAt >= 12) break;
            }
            if (lineIndex < items.length) {
              window.setTimeout(processAppearanceChunk, 0);
            } else {
              releaseAndResolve();
            }
          }

          processAppearanceChunk();
        };
        image.onerror = function () {
          applyFallback();
          resolve(items);
        };
        image.src = "data:image/png;base64," + imageBase64;
      });
    }

    function normalizeOcrResponse(data) {
      var root = data && (data.data || data.result) || data || {};
      if (root.result && !root.lines && !root.items) root = root.result;
      var candidates = Array.isArray(root) ? root :
        root.lines || root.items || root.words || root.results || [];
      var lines = [];

      /*
       * 兼容 PaddleOCR 3.x 的原生字段：
       * rec_texts / rec_scores / rec_polys（或 dt_polys）。
       */
      if (
        !Array.isArray(candidates) ||
        (!candidates.length && Array.isArray(root.rec_texts))
      ) {
        candidates = Array.isArray(root.rec_texts)
          ? root.rec_texts.map(function (text, index) {
              return {
                text: text,
                score: root.rec_scores && root.rec_scores[index],
                box: (root.rec_polys && root.rec_polys[index]) ||
                  (root.dt_polys && root.dt_polys[index])
              };
            })
          : [];
      }
      if (!Array.isArray(candidates)) candidates = [];
      candidates.forEach(function (item) {
        /*
         * 兼容 PaddleOCR 2.x 常见结果：
         * [ [[x,y]...], ["文字", 0.98] ]
         */
        var paddlePair = Array.isArray(item) && item.length >= 2 &&
          Array.isArray(item[0]) ? item : null;
        var recognition = paddlePair && Array.isArray(paddlePair[1])
          ? paddlePair[1] : null;
        var text = String(
          recognition ? recognition[0] :
          item && (item.text != null ? item.text :
            item.word != null ? item.word : item.content) || ""
        ).trim();
        var box = normalizeOcrBox(
          paddlePair ? paddlePair[0] :
          item && (item.box || item.bbox || item.boundingBox ||
            item.rect || item.polygon || item.poly || item)
        );
        if (!text || !box || !(box.width > 0 && box.height > 0)) return;
        var style = item && item.style && typeof item.style === "object"
          ? item.style : {};
        lines.push({
          /* 保留 OCR 原始行身份。像素分析后的分段只能回并到自己的来源行，
             避免把相邻的独立文案误合并。 */
          sourceLineId: "ocr-line-" + lines.length,
          text: text,
          box: box,
          score: Math.max(0, Math.min(1, Number(
            recognition ? recognition[1] :
            item.score != null ? item.score :
              item.confidence != null ? item.confidence : 1
          ) || 0)),
          color: normalizeHexColor(
            item.color || item.textColor || style.color || style.textColor
          ),
          fontFamily: String(
            item.font_family || item.fontFamily ||
            style.font_family || style.fontFamily || ""
          ).trim(),
          fontStyle: /serif|song|simsun|宋|明朝|mincho|source.?han.?serif|noto.?serif/i.test(String(
            item.font_style || item.fontStyle || item.font_family || item.fontFamily ||
            style.font_style || style.fontStyle || style.font_family ||
            style.fontFamily || "sans"
          )) ? "serif" : "sans",
          weight: /black|heavy|extra.?bold|ultra.?bold|[89]00/i.test(String(
            item.weight || item.font_weight ||
            style.weight || style.fontWeight || ""
          )) ? "black" : /bold|semibold|[67]00/i.test(String(
            item.weight || item.font_weight ||
            style.weight || style.fontWeight || ""
          )) ? "bold" : "regular",
          weightValue: Number(
            item.weight_value || item.weightValue || item.font_weight_value ||
            style.weight_value || style.weightValue || 0
          ) || 0,
          fontSize: Number(
            item.font_size || item.fontSize ||
            style.font_size || style.fontSize || 0
          ) || 0,
          angle: Number(
            item.angle || item.rotation || style.angle || style.rotation || 0
          ) || 0,
          serviceGroup: Number(item.group_id != null
            ? item.group_id : item.groupId)
        });
      });

      if (!lines.length) throw new Error("未识别到带坐标的文字");
      return {
        lines: lines,
        engine: String(root.engine || (data && data.engine) || "OCR"),
        elapsedMs: Number(
          root.elapsed_ms || root.elapsedMs || (data && data.elapsed_ms) || 0
        )
      };
    }

    function glyphWidthWeight(text) {
      var value = String(text || "");
      var total = 0;
      var index;
      for (index = 0; index < value.length; index += 1) {
        var character = value.charAt(index);
        if (/\s/.test(character)) total += 0.32;
        else if (/[0-9]/.test(character)) total += 0.62;
        else if (/[A-Za-z]/.test(character)) total += 0.60;
        else if (/[,.:;，。：；'"]/i.test(character)) total += 0.34;
        else total += 1;
      }
      return Math.max(0.35, total);
    }

    function copyOcrLine(line, text, box, part, fontScale) {
      return {
        text: String(text || "").trim(),
        box: box,
        score: line.score,
        sourceLineId: line.sourceLineId || "",
        color: line.color,
        colorSource: line.colorSource,
        fontFamily: line.fontFamily || "",
        fontStyle: line.fontStyle,
        fontStyleSource: line.fontStyleSource || "",
        fontStyleConfidence: Number(line.fontStyleConfidence) || 0,
        strokeRatio: Number(line.strokeRatio) || 0,
        weight: line.weight,
        weightValue: Number(line.weightValue) || 0,
        weightScore: Number(line.weightScore) || 0,
        letterSpacing: isFinite(Number(line.letterSpacing))
          ? Number(line.letterSpacing)
          : null,
        fontSize: line.fontSize
          ? line.fontSize * (fontScale || 1)
          : 0,
        fontHeight: line.fontHeight
          ? line.fontHeight * (fontScale || 1)
          : 0,
        angle: line.angle,
        serviceGroup: line.serviceGroup,
        tableLayout: !!line.tableLayout,
        tableRow: isFinite(Number(line.tableRow)) ? Number(line.tableRow) : null,
        tableColumn: isFinite(Number(line.tableColumn)) ? Number(line.tableColumn) : null,
        tableBoundary: isFinite(Number(line.tableBoundary)) ? Number(line.tableBoundary) : null,
        mixedSizePart: part || "",
        boxSource: line.boxSource || ""
      };
    }

    function ocrHexRgb(value) {
      var color = normalizeHexColor(value);
      if (!color) return [17, 17, 17];
      return [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16)
      ];
    }

    function ocrColorDistance(left, right) {
      return colorDistance(ocrHexRgb(left), ocrHexRgb(right));
    }

    function isReadableOcrText(text) {
      return /[0-9A-Za-z\u3400-\u9FFF]/.test(String(text || ""));
    }

    function isLikelyIconOcrLine(line) {
      var text = String(line && line.text || "").trim();
      var box = line && line.box ? line.box : { width: 0, height: 0 };
      if (!text) return false;
      if (
        /^[|丨┃¦!！Il]+$/.test(text) &&
        box.height > 0 &&
        box.width <= box.height * 0.72
      ) {
        return true;
      }
      if (isReadableOcrText(text)) return false;
      if (/^[!！?？%％+＝=…、，。,.：:;；()（）\-—\/\\]+$/.test(text)) {
        return false;
      }
      return text.length <= 4;
    }

    function sameOcrVisualRow(row, line) {
      var box = line.box;
      var lineCenter = box.y + box.height / 2;
      var lineBaseline = box.y + box.height;
      var rowCenter = ocrMedian(row.centers, (row.top + row.bottom) / 2);
      var rowBaseline = ocrMedian(row.baselines, row.bottom);
      var rowHeight = ocrMedian(row.heights, row.height);
      var referenceHeight = Math.max(1, Math.max(rowHeight, box.height));
      var overlap = Math.max(
        0,
        Math.min(row.bottom, box.y + box.height) - Math.max(row.top, box.y)
      );
      var smallerHeight = Math.max(1, Math.min(rowHeight, box.height));
      var overlapRatio = overlap / smallerHeight;
      var centerDifference = Math.abs(rowCenter - lineCenter) / referenceHeight;
      var baselineDifference = Math.abs(rowBaseline - lineBaseline) / referenceHeight;
      return overlapRatio >= 0.54 ||
        (centerDifference <= 0.34 && baselineDifference <= 0.34);
    }

    function textJoiner(left, right, gap, height) {
      if (/^[，。！？、：；,.!?:;%％)）]/.test(right)) return "";
      if (/[(（]$/.test(left)) return "";
      if (
        /[A-Za-z0-9]$/.test(left) &&
        /^[A-Za-z0-9]/.test(right) &&
        gap > height * 0.16
      ) {
        return " ";
      }
      return "";
    }

    function normalizedOcrFontFamily(line) {
      return String(line && line.fontFamily || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[\-_]/g, "");
    }

    function ocrFragmentStyleCompatible(left, right) {
      var leftBox = left.box;
      var rightBox = right.box;
      var leftFamily = normalizedOcrFontFamily(left);
      var rightFamily = normalizedOcrFontFamily(right);
      if (leftFamily && rightFamily && leftFamily !== rightFamily) return false;
      if (String(left.fontStyle || "") !== String(right.fontStyle || "")) {
        return false;
      }
      if (String(left.weight || "") !== String(right.weight || "")) {
        var leftTextLength = ocrTextCharacters(left.text).length;
        var rightTextLength = ocrTextCharacters(right.text).length;
        var isolatedFragment = Math.min(leftTextLength, rightTextLength) <= 1;
        var labelWeightDifference = Math.abs(
          (Number(left.weightScore) || 0) - (Number(right.weightScore) || 0)
        );
        if (!(isolatedFragment && labelWeightDifference <= 0.055)) return false;
      }
      var heightRatio = Math.abs(leftBox.height - rightBox.height) /
        Math.max(1, Math.max(leftBox.height, rightBox.height));
      if (heightRatio > 0.17) return false;
      if (ocrColorDistance(left.color, right.color) > 38) return false;

      var leftWeightScore = Number(left.weightScore) || 0;
      var rightWeightScore = Number(right.weightScore) || 0;
      if (leftWeightScore > 0 && rightWeightScore > 0) {
        var weightDifference = Math.abs(leftWeightScore - rightWeightScore) /
          Math.max(0.04, Math.max(leftWeightScore, rightWeightScore));
        if (weightDifference > 0.34 &&
            Math.abs(leftWeightScore - rightWeightScore) > 0.045) {
          return false;
        }
      }
      var leftSpacing = Number(left.letterSpacing);
      var rightSpacing = Number(right.letterSpacing);
      if (isFinite(leftSpacing) && isFinite(rightSpacing) &&
          leftSpacing >= 0 && rightSpacing >= 0) {
        var height = Math.max(1, Math.min(leftBox.height, rightBox.height));
        if (
          Math.abs(leftSpacing - rightSpacing) > height * 0.18 &&
          Math.max(leftSpacing, rightSpacing) /
            Math.max(1, Math.min(leftSpacing, rightSpacing)) > 1.8
        ) {
          return false;
        }
      }
      return true;
    }

    function rowOcrGapContext(items) {
      var gaps = [];
      var index;
      for (index = 1; index < items.length; index += 1) {
        var left = items[index - 1];
        var right = items[index];
        if (!ocrFragmentStyleCompatible(left, right)) continue;
        var height = Math.max(1, Math.min(left.box.height, right.box.height));
        var gap = right.box.x - (left.box.x + left.box.width);
        if (gap >= -height * 0.18 && gap <= height * 1.9) {
          gaps.push(gap / height);
        }
      }
      var median = ocrMedian(gaps, 0.24);
      var mad = ocrMad(gaps, median);
      return {
        sampleCount: gaps.length,
        normalizedMedian: median,
        normalizedMad: mad
      };
    }

    function canMergeOcrFragments(left, right, gapContext) {
      var leftBox = left.box;
      var rightBox = right.box;
      var smallerHeight = Math.max(1, Math.min(leftBox.height, rightBox.height));
      var verticalOverlap = Math.max(
        0,
        Math.min(
          leftBox.y + leftBox.height,
          rightBox.y + rightBox.height
        ) - Math.max(leftBox.y, rightBox.y)
      );
      var gap = rightBox.x - (leftBox.x + leftBox.width);
      var leftGroup = Number(left.serviceGroup);
      var rightGroup = Number(right.serviceGroup);
      var serviceGroupsConflict =
        isFinite(leftGroup) && isFinite(rightGroup) &&
        leftGroup !== rightGroup;
      if (serviceGroupsConflict || !ocrFragmentStyleCompatible(left, right)) {
        return false;
      }

      var context = gapContext || {
        sampleCount: 0,
        normalizedMedian: 0.24,
        normalizedMad: 0
      };
      var normalizedAllowed;
      if (context.sampleCount >= 3) {
        normalizedAllowed = context.normalizedMedian + Math.max(
          0.18,
          context.normalizedMad * 3.2
        );
        normalizedAllowed = Math.max(0.56, Math.min(1.85, normalizedAllowed));
      } else {
        normalizedAllowed = 0.78;
      }

      return verticalOverlap >= smallerHeight * 0.54 &&
        Math.abs((Number(left.angle) || 0) - (Number(right.angle) || 0)) <= 3 &&
        gap >= -smallerHeight * 0.18 &&
        gap <= Math.max(4, smallerHeight * normalizedAllowed);
    }

    function mergeOcrFragments(left, right) {
      var leftBox = left.box;
      var rightBox = right.box;
      var leftEdge = Math.min(leftBox.x, rightBox.x);
      var topEdge = Math.min(leftBox.y, rightBox.y);
      var rightEdge = Math.max(
        leftBox.x + leftBox.width,
        rightBox.x + rightBox.width
      );
      var bottomEdge = Math.max(
        leftBox.y + leftBox.height,
        rightBox.y + rightBox.height
      );
      var gap = rightBox.x - (leftBox.x + leftBox.width);
      var merged = copyOcrLine(
        left,
        String(left.text || "") + textJoiner(
          String(left.text || ""),
          String(right.text || ""),
          gap,
          Math.min(leftBox.height, rightBox.height)
        ) + String(right.text || ""),
        {
          x: leftEdge,
          y: topEdge,
          width: Math.max(1, rightEdge - leftEdge),
          height: Math.max(1, bottomEdge - topEdge)
        },
        "",
        1
      );
      merged.score = Math.min(
        Number(left.score) || 0,
        Number(right.score) || 0
      );
      var leftCount = Number(left.mergedFragments) || 1;
      var rightCount = Number(right.mergedFragments) || 1;
      merged.mergedFragments = leftCount + rightCount;
      merged.fontHeight = ocrMedian([
        Number(left.fontHeight) || leftBox.height,
        Number(right.fontHeight) || rightBox.height
      ], merged.box.height);
      merged.weightScore = (
        (Number(left.weightScore) || 0) * leftCount +
        (Number(right.weightScore) || 0) * rightCount
      ) / Math.max(1, leftCount + rightCount);
      merged.letterSpacing = ocrMedian([
        Number(left.letterSpacing),
        Number(right.letterSpacing),
        gap
      ].filter(function (value) {
        return isFinite(value) && value >= 0;
      }), 0);
      return merged;
    }

    function ocrLineStyleDistance(line, reference) {
      if (!line || !reference || !line.box || !reference.box) return 999;
      var referenceHeight = Math.max(
        1, Math.max(line.box.height, reference.box.height)
      );
      var colorCost = ocrColorDistance(line.color, reference.color) / 55;
      var heightCost = Math.abs(line.box.height - reference.box.height) /
        referenceHeight / 0.18;
      var weightCost = Math.abs(
        (Number(line.weightScore) || 0) - (Number(reference.weightScore) || 0)
      ) / 0.055;
      var familyCost = 0;
      var leftFamily = normalizedOcrFontFamily(line);
      var rightFamily = normalizedOcrFontFamily(reference);
      if (leftFamily && rightFamily && leftFamily !== rightFamily) familyCost = 2.2;
      if (String(line.fontStyle || "") !== String(reference.fontStyle || "")) {
        familyCost += 1.6;
      }
      return colorCost * 1.55 + heightCost + weightCost * 0.65 + familyCost;
    }

    function mergeOcrFragmentsUsingStyle(left, right, styleSource) {
      var merged = mergeOcrFragments(left, right);
      var source = styleSource || left;
      merged.color = source.color;
      merged.colorSource = source.colorSource;
      merged.fontFamily = source.fontFamily || "";
      merged.fontStyle = source.fontStyle;
      merged.weight = source.weight;
      merged.weightValue = Number(source.weightValue) || 0;
      merged.weightScore = Number(source.weightScore) || merged.weightScore;
      merged.fontHeight = Number(source.fontHeight) || merged.fontHeight;
      return merged;
    }


    function canCollapseOcrSentencePair(left, right, rowHeight) {
      if (!left || !right || !left.box || !right.box) return false;
      if (left.tableCell || right.tableCell || left.tableLayout || right.tableLayout) {
        return false;
      }
      var leftText = String(left.text || "").trim();
      var rightText = String(right.text || "").trim();
      if (!leftText || !rightText) return false;
      if (!isReadableOcrText(leftText) || !isReadableOcrText(rightText)) {
        return false;
      }
      var sameSourceLine = !!left.sourceLineId &&
        left.sourceLineId === right.sourceLineId;
      var leftFamily = normalizedOcrFontFamily(left);
      var rightFamily = normalizedOcrFontFamily(right);
      if (leftFamily && rightFamily && leftFamily !== rightFamily) return false;
      if (String(left.fontStyle || "") !== String(right.fontStyle || "")) {
        return false;
      }

      var referenceHeight = Math.max(
        1,
        rowHeight || 0,
        Number(left.box.height) || 0,
        Number(right.box.height) || 0
      );
      var heightDifference = Math.abs(
        (Number(left.box.height) || 0) - (Number(right.box.height) || 0)
      ) / referenceHeight;
      if (heightDifference > 0.2) return false;

      if (ocrColorDistance(left.color, right.color) > (sameSourceLine ? 60 : 52)) {
        return false;
      }

      var leftWeightScore = Number(left.weightScore) || 0;
      var rightWeightScore = Number(right.weightScore) || 0;
      if (leftWeightScore > 0 && rightWeightScore > 0) {
        /* 同一 OCR 行的视觉分段会受汉字笔画密度影响；此时不以密度差
           否决回并，颜色和高度仍须一致。 */
        if (!sameSourceLine && Math.abs(leftWeightScore - rightWeightScore) > 0.075) {
          return false;
        }
      } else if (
        String(left.weight || "") && String(right.weight || "") &&
        String(left.weight || "") !== String(right.weight || "")
      ) {
        return false;
      }

      var gap = (Number(right.box.x) || 0) - (
        (Number(left.box.x) || 0) + (Number(left.box.width) || 0)
      );
      if (/[|丨┃¦/／•·▪]/.test(leftText + rightText)) return false;
      if (gap < -referenceHeight * 0.2) return false;
      if (gap > Math.max(14, referenceHeight * (sameSourceLine ? 1.95 : 1.75))) {
        return false;
      }

      if (Math.abs((Number(left.angle) || 0) - (Number(right.angle) || 0)) > 3) {
        return false;
      }
      return true;
    }

    /*
     * 某些整句会先被像素分析拆成多个短语片段，随后因细微颜色/字重抖动
     * 没有重新合并，最终一行被生成多个文字层。这里对同一视觉行做一次
     * “整句回并”：仅当连续片段字体族、字形、颜色、字重和高度都足够接近，
     * 且片段间距没有明显形成多列结构时，整行合并回一个文字层。
     */
    function collapseUniformOcrSentenceRow(items) {
      var rowItems = (items || []).slice();
      if (rowItems.length < 2) return rowItems;
      var totalChars = 0;
      var heights = [];
      var hasVisualSplit = false;
      rowItems.forEach(function (item) {
        totalChars += ocrTextCharacters(item.text).length;
        heights.push(Number(item.box && item.box.height) || 1);
        if (/image-(style|gap)-segment|visual-(style|gap)|row-collapse/.test(String(item.boxSource || ""))) {
          hasVisualSplit = true;
        }
      });
      if (totalChars < 4) return rowItems;
      if (rowItems.length < 3 && !hasVisualSplit && totalChars < 8) return rowItems;

      var rowHeight = ocrMedian(heights, Math.max.apply(Math, heights));
      var index;
      for (index = 1; index < rowItems.length; index += 1) {
        if (!canCollapseOcrSentencePair(rowItems[index - 1], rowItems[index], rowHeight)) {
          return rowItems;
        }
      }

      var merged = copyOcrLine(
        rowItems[0],
        rowItems[0].text,
        {
          x: rowItems[0].box.x,
          y: rowItems[0].box.y,
          width: rowItems[0].box.width,
          height: rowItems[0].box.height
        },
        "",
        1
      );
      merged.boxSource = "row-collapse";
      for (index = 1; index < rowItems.length; index += 1) {
        merged = mergeOcrFragmentsUsingStyle(merged, rowItems[index], merged);
        merged.boxSource = "row-collapse";
      }
      return [merged];
    }

    /* OCR 服务若单独返回一个汉字，局部抗锯齿可能使它的颜色或字重
       标签漂移。比较该字与左右连续片段，优先并入明显更相似的一侧。 */
    function suppressOcrSingletonFragments(items) {
      var output = (items || []).slice();
      var changed = true;
      while (changed && output.length >= 3) {
        changed = false;
        var index;
        for (index = 1; index < output.length - 1; index += 1) {
          var current = output[index];
          if (ocrTextCharacters(current.text).length !== 1 ||
              /^[，。！？、：；,.!?:;%％()（）]$/.test(String(current.text || ""))) {
            continue;
          }
          var previous = output[index - 1];
          var next = output[index + 1];
          var height = Math.max(1, Number(current.box.height) || 1);
          var previousGap = current.box.x -
            (previous.box.x + previous.box.width);
          var nextGap = next.box.x -
            (current.box.x + current.box.width);
          if (previousGap > height * 0.82 && nextGap > height * 0.82) continue;
          var previousColor = ocrColorDistance(current.color, previous.color);
          var nextColor = ocrColorDistance(current.color, next.color);
          var uniqueColor = previousColor >= 72 && nextColor >= 72;
          var previousHeightDifference = Math.abs(
            current.box.height - previous.box.height
          ) / Math.max(1, Math.max(current.box.height, previous.box.height));
          var nextHeightDifference = Math.abs(
            current.box.height - next.box.height
          ) / Math.max(1, Math.max(current.box.height, next.box.height));
          if (uniqueColor && previousHeightDifference >= 0.22 &&
              nextHeightDifference >= 0.22) continue;
          var previousDistance = ocrLineStyleDistance(current, previous) +
            Math.max(0, previousGap / height) * 0.35;
          var nextDistance = ocrLineStyleDistance(current, next) +
            Math.max(0, nextGap / height) * 0.35;
          if (Math.min(previousDistance, nextDistance) > 4.2) continue;
          if (previousDistance <= nextDistance) {
            output[index - 1] = mergeOcrFragmentsUsingStyle(
              previous, current, previous
            );
            output.splice(index, 1);
          } else {
            output[index] = mergeOcrFragmentsUsingStyle(
              current, next, next
            );
            output.splice(index + 1, 1);
          }
          changed = true;
          break;
        }
      }
      return output;
    }

    function buildOcrVisualRows(lines) {
      var readable = (lines || []).filter(function (line) {
        return line && line.box && line.text && !isLikelyIconOcrLine(line);
      }).slice().sort(function (left, right) {
        var leftCenter = left.box.y + left.box.height / 2;
        var rightCenter = right.box.y + right.box.height / 2;
        return leftCenter - rightCenter || left.box.x - right.box.x;
      });
      var rows = [];
      readable.forEach(function (line) {
        var chosen = null;
        var bestScore = Infinity;
        rows.forEach(function (row) {
          if (!sameOcrVisualRow(row, line)) return;
          var center = line.box.y + line.box.height / 2;
          var baseline = line.box.y + line.box.height;
          var rowCenter = ocrMedian(row.centers, center);
          var rowBaseline = ocrMedian(row.baselines, baseline);
          var referenceHeight = Math.max(
            1,
            ocrMedian(row.heights, line.box.height),
            line.box.height
          );
          var score = Math.abs(center - rowCenter) / referenceHeight +
            Math.abs(baseline - rowBaseline) / referenceHeight;
          if (score < bestScore) {
            bestScore = score;
            chosen = row;
          }
        });
        if (!chosen) {
          chosen = {
            index: rows.length,
            top: line.box.y,
            bottom: line.box.y + line.box.height,
            height: line.box.height,
            centers: [],
            baselines: [],
            heights: [],
            items: []
          };
          rows.push(chosen);
        }
        chosen.items.push(line);
        chosen.centers.push(line.box.y + line.box.height / 2);
        chosen.baselines.push(line.box.y + line.box.height);
        chosen.heights.push(line.box.height);
        chosen.top = Math.min(chosen.top, line.box.y);
        chosen.bottom = Math.max(chosen.bottom, line.box.y + line.box.height);
        chosen.height = ocrMedian(chosen.heights, chosen.bottom - chosen.top);
      });
      rows.sort(function (left, right) {
        return left.top - right.top;
      });
      rows.forEach(function (row, index) {
        row.index = index;
        row.items.sort(function (left, right) {
          return left.box.x - right.box.x;
        });
      });
      return rows;
    }

    function detectOcrTableLayout(lines) {
      var rows = buildOcrVisualRows(lines);
      if (rows.length < 3 || rows.length > 40) return null;
      var rowHeights = rows.map(function (row) {
        return Math.max(1, Number(row.height) || 1);
      });
      var medianHeight = ocrMedian(rowHeights, 18);
      var minimumGap = Math.max(12, medianHeight * 0.9);
      var candidates = [];
      var minX = Infinity;
      var maxX = -Infinity;

      rows.forEach(function (row) {
        row.items.forEach(function (line) {
          minX = Math.min(minX, line.box.x);
          maxX = Math.max(maxX, line.box.x + line.box.width);
        });
        var rowCandidates = [];
        var index;
        for (index = 1; index < row.items.length; index += 1) {
          var left = row.items[index - 1];
          var right = row.items[index];
          var gap = right.box.x - (left.box.x + left.box.width);
          if (gap < minimumGap) continue;
          rowCandidates.push({
            x: left.box.x + left.box.width + gap / 2,
            gap: gap,
            ratio: gap / Math.max(1, row.height),
            row: row.index
          });
        }
        rowCandidates.sort(function (left, right) {
          return right.gap - left.gap;
        });
        rowCandidates.slice(0, 3).forEach(function (candidate) {
          candidates.push(candidate);
        });
      });

      if (!candidates.length || !(maxX > minX)) return null;
      var tolerance = Math.max(10, medianHeight * 0.72);
      var clusters = [];
      candidates.sort(function (left, right) { return left.x - right.x; });
      candidates.forEach(function (candidate) {
        var chosen = null;
        clusters.forEach(function (cluster) {
          if (chosen) return;
          if (Math.abs(cluster.x - candidate.x) <= tolerance) chosen = cluster;
        });
        if (!chosen) {
          chosen = { x: candidate.x, values: [], rows: {}, ratios: [], gaps: [] };
          clusters.push(chosen);
        }
        chosen.values.push(candidate.x);
        chosen.rows[candidate.row] = true;
        chosen.ratios.push(candidate.ratio);
        chosen.gaps.push(candidate.gap);
        chosen.x = ocrMedian(chosen.values, chosen.x);
      });

      var requiredSupport = Math.max(3, Math.ceil(rows.length * 0.6));
      var width = maxX - minX;
      var accepted = clusters.filter(function (cluster) {
        var support = Object.keys(cluster.rows).length;
        var ratio = ocrMedian(cluster.ratios, 0);
        return support >= requiredSupport &&
          ratio >= 0.9 &&
          cluster.x > minX + width * 0.14 &&
          cluster.x < maxX - width * 0.14;
      }).sort(function (left, right) {
        var leftScore = Object.keys(left.rows).length *
          ocrMedian(left.ratios, 0);
        var rightScore = Object.keys(right.rows).length *
          ocrMedian(right.ratios, 0);
        return rightScore - leftScore;
      });

      if (!accepted.length) return null;
      /* 当前文字恢复以最稳定的一条纵向分隔为主，避免同一单元格内的
         词间空隙被误识别成额外列。 */
      var boundary = accepted[0].x;
      var rowsWithBothSides = 0;
      rows.forEach(function (row) {
        var hasLeft = false;
        var hasRight = false;
        row.items.forEach(function (line) {
          var center = line.box.x + line.box.width / 2;
          if (center < boundary) hasLeft = true;
          else hasRight = true;
        });
        if (hasLeft && hasRight) rowsWithBothSides += 1;
      });
      if (rowsWithBothSides < requiredSupport) return null;

      return {
        rows: rows,
        boundary: boundary,
        columnCount: 2,
        supportRows: rowsWithBothSides,
        minX: minX,
        maxX: maxX,
        medianHeight: medianHeight
      };
    }

    function markOcrTableLayoutHints(lines) {
      var layout = detectOcrTableLayout(lines);
      if (!layout) return null;
      layout.rows.forEach(function (row) {
        row.items.forEach(function (line) {
          var center = line.box.x + line.box.width / 2;
          var overlap = Math.min(
            line.box.x + line.box.width,
            layout.boundary + layout.medianHeight * 0.18
          ) - Math.max(
            line.box.x,
            layout.boundary - layout.medianHeight * 0.18
          );
          /* 横跨分隔线的大框不强制归入单元格，交给普通逻辑处理。 */
          if (overlap > Math.min(line.box.width, layout.medianHeight) * 0.55) {
            return;
          }
          line.tableLayout = true;
          line.tableRow = row.index;
          line.tableColumn = center < layout.boundary ? 0 : 1;
          line.tableBoundary = layout.boundary;
        });
      });
      return layout;
    }

    function tableCellJoiner(left, right, gap, height) {
      left = String(left || "");
      right = String(right || "");
      if (!left || !right) return "";
      if (/^[，。！？、：；,.!?:;%％)）]/.test(right)) return "";
      if (/[(（]$/.test(left)) return "";
      if (/[/／]$/.test(left) || /^[/／]/.test(right)) return " ";
      if (gap > Math.max(3, height * 0.42)) return " ";
      return "";
    }

    function dominantOcrCellValue(items, getter, fallback) {
      var scores = {};
      var originals = {};
      (items || []).forEach(function (item) {
        var value = getter(item);
        if (value === undefined || value === null || value === "") return;
        var key = String(value).toLowerCase();
        var weight = Math.max(1, ocrTextCharacters(item.text).length) *
          Math.max(1, Number(item.box && item.box.height) || 1);
        scores[key] = (scores[key] || 0) + weight;
        originals[key] = value;
      });
      var best = "";
      Object.keys(scores).forEach(function (key) {
        if (!best || scores[key] > scores[best]) best = key;
      });
      return best ? originals[best] : fallback;
    }

    function mergeOcrTableCellItems(items, rowIndex, columnIndex, boundary) {
      var sorted = (items || []).slice().sort(function (left, right) {
        return left.box.x - right.box.x;
      });
      if (!sorted.length) return null;
      var leftEdge = Infinity;
      var topEdge = Infinity;
      var rightEdge = -Infinity;
      var bottomEdge = -Infinity;
      var text = "";
      var previous = null;
      var scores = [];
      var heights = [];
      var weightScores = [];
      var spacings = [];

      sorted.forEach(function (line) {
        if (previous) {
          var gap = line.box.x - (previous.box.x + previous.box.width);
          text += tableCellJoiner(
            previous.text,
            line.text,
            gap,
            Math.min(previous.box.height, line.box.height)
          );
          if (gap >= 0) spacings.push(gap);
        }
        text += String(line.text || "");
        leftEdge = Math.min(leftEdge, line.box.x);
        topEdge = Math.min(topEdge, line.box.y);
        rightEdge = Math.max(rightEdge, line.box.x + line.box.width);
        bottomEdge = Math.max(bottomEdge, line.box.y + line.box.height);
        scores.push(Number(line.score) || 0);
        heights.push(Number(line.fontHeight) || Number(line.box.height) || 1);
        if (Number(line.weightScore) > 0) weightScores.push(Number(line.weightScore));
        if (isFinite(Number(line.letterSpacing)) && Number(line.letterSpacing) >= 0) {
          spacings.push(Number(line.letterSpacing));
        }
        previous = line;
      });

      var seed = sorted[0];
      var merged = copyOcrLine(seed, text.replace(/^\s+|\s+$/g, ""), {
        x: leftEdge,
        y: topEdge,
        width: Math.max(1, rightEdge - leftEdge),
        height: Math.max(1, bottomEdge - topEdge)
      }, "table-cell", 1);
      merged.score = scores.length ? Math.min.apply(Math, scores) : seed.score;
      merged.color = dominantOcrCellValue(sorted, function (item) {
        return normalizeHexColor(item.color);
      }, seed.color || "#111111");
      merged.fontFamily = dominantOcrCellValue(sorted, function (item) {
        return normalizedOcrFontFamily(item) ? item.fontFamily : "";
      }, seed.fontFamily || "");
      merged.fontStyle = dominantOcrCellValue(sorted, function (item) {
        return item.fontStyle || "sans";
      }, seed.fontStyle || "sans");
      merged.weight = dominantOcrCellValue(sorted, function (item) {
        return item.weight || "regular";
      }, seed.weight || "regular");
      merged.fontHeight = ocrMedian(heights, merged.box.height);
      merged.weightScore = ocrMedian(weightScores, Number(seed.weightScore) || 0);
      merged.letterSpacing = ocrMedian(spacings, 0);
      merged.tableLayout = true;
      merged.tableCell = true;
      merged.tableRow = rowIndex;
      merged.tableColumn = columnIndex;
      merged.tableBoundary = boundary;
      merged.visualTextSegments = null;
      merged.boxSource = "table-cell";
      return merged;
    }

    function groupOcrTableCells(lines, knownLayout) {
      var layout = knownLayout || detectOcrTableLayout(lines);
      if (!layout) return null;
      var rows = buildOcrVisualRows(lines);
      if (rows.length < 3) return null;
      var output = [];
      var rowsWithTwoCells = 0;
      rows.forEach(function (row, rowIndex) {
        var cells = [[], []];
        row.items.forEach(function (line) {
          var column = isFinite(Number(line.tableColumn))
            ? Number(line.tableColumn)
            : (line.box.x + line.box.width / 2 < layout.boundary ? 0 : 1);
          cells[column === 0 ? 0 : 1].push(line);
        });
        if (cells[0].length && cells[1].length) rowsWithTwoCells += 1;
        cells.forEach(function (items, columnIndex) {
          var cell = mergeOcrTableCellItems(
            items,
            rowIndex,
            columnIndex,
            layout.boundary
          );
          if (cell && cell.text) output.push(cell);
        });
      });
      var requiredSupport = Math.max(3, Math.ceil(rows.length * 0.6));
      if (rowsWithTwoCells < requiredSupport) return null;
      return output.sort(function (left, right) {
        return left.tableRow - right.tableRow ||
          left.tableColumn - right.tableColumn;
      });
    }

    /*
     * 分组顺序固定为：先按基线独立分行，再在每一行内部判断样式与间距。
     * 行与行之间绝不共享横向切割位置。颜色、字号、字体族、字重或稳定
     * 字间距发生变化时保持拆分；同样式且间距属于本行正常分布时合并。
     */
    function groupOcrTextFragments(lines) {
      var readable = (lines || []).filter(function (line) {
        return line && line.box && line.text && !isLikelyIconOcrLine(line);
      }).slice().sort(function (left, right) {
        var leftCenter = left.box.y + left.box.height / 2;
        var rightCenter = right.box.y + right.box.height / 2;
        return leftCenter - rightCenter || left.box.x - right.box.x;
      });
      var rows = [];

      readable.forEach(function (line) {
        var chosen = null;
        var bestScore = Infinity;
        rows.forEach(function (row) {
          if (!sameOcrVisualRow(row, line)) return;
          var center = line.box.y + line.box.height / 2;
          var baseline = line.box.y + line.box.height;
          var rowCenter = ocrMedian(row.centers, center);
          var rowBaseline = ocrMedian(row.baselines, baseline);
          var referenceHeight = Math.max(
            1,
            ocrMedian(row.heights, line.box.height),
            line.box.height
          );
          var score = Math.abs(center - rowCenter) / referenceHeight +
            Math.abs(baseline - rowBaseline) / referenceHeight;
          if (score < bestScore) {
            bestScore = score;
            chosen = row;
          }
        });
        if (!chosen) {
          chosen = {
            top: line.box.y,
            bottom: line.box.y + line.box.height,
            height: line.box.height,
            centers: [],
            baselines: [],
            heights: [],
            items: []
          };
          rows.push(chosen);
        }
        chosen.items.push(line);
        chosen.centers.push(line.box.y + line.box.height / 2);
        chosen.baselines.push(line.box.y + line.box.height);
        chosen.heights.push(line.box.height);
        chosen.top = Math.min(chosen.top, line.box.y);
        chosen.bottom = Math.max(chosen.bottom, line.box.y + line.box.height);
        chosen.height = ocrMedian(chosen.heights, chosen.bottom - chosen.top);
      });

      var output = [];
      rows.forEach(function (row) {
        row.items.sort(function (left, right) {
          return left.box.x - right.box.x;
        });
        var gapContext = rowOcrGapContext(row.items);
        var mergedRow = [];
        row.items.forEach(function (line) {
          var previous = mergedRow.length
            ? mergedRow[mergedRow.length - 1]
            : null;
          if (previous && canMergeOcrFragments(previous, line, gapContext)) {
            mergedRow[mergedRow.length - 1] = mergeOcrFragments(previous, line);
          } else {
            mergedRow.push(copyOcrLine(
              line,
              line.text,
              {
                x: line.box.x,
                y: line.box.y,
                width: line.box.width,
                height: line.box.height
              },
              "",
              1
            ));
          }
        });
        mergedRow = suppressOcrSingletonFragments(mergedRow);
        mergedRow = collapseUniformOcrSentenceRow(mergedRow);
        output = output.concat(mergedRow);
      });

      return output.sort(function (left, right) {
        return left.box.y - right.box.y || left.box.x - right.box.x;
      });
    }


    function shouldKeepLargeSentenceMerged(line, segments) {
      if (!line || !line.box || !(segments instanceof Array) || segments.length < 2) {
        return false;
      }
      var originalText = String(line.text || "").replace(/\s+/g, "").trim();
      if (!originalText || /[|丨┃¦/／•·▪!！?？]/.test(originalText)) return false;
      var lineHeight = Math.max(
        1,
        Number(line.fontHeight) || 0,
        Number(line.box.height) || 0
      );
      if (lineHeight < 24 || ocrTextCharacters(originalText).length < 5) return false;

      var index;
      for (index = 0; index < segments.length; index += 1) {
        var current = segments[index];
        var currentHeight = Math.max(1, Number(current.fontHeight) || Number(current.height) || lineHeight);
        var currentWidth = Math.max(1, Number(current.width) || 1);
        if (currentWidth <= currentHeight * 0.72) return false;
        if (Math.abs(currentHeight - lineHeight) / lineHeight > 0.22) return false;
        if (current.color && line.color && ocrColorDistance(current.color, line.color) > 58) {
          return false;
        }
        if (index > 0) {
          var previous = segments[index - 1];
          var gap = (Number(current.x) || 0) - (
            (Number(previous.x) || 0) + (Number(previous.width) || 0)
          );
          if (gap > Math.max(18, lineHeight * 1.55)) return false;
        }
      }
      return true;
    }

    /*
     * 有些 OCR 会把整条“图标 + 短语 + 分隔线 + 图标 + 短语”返回成
     * 一个超宽文字框。像素分析已记录多个宽文字簇时，将中文内容按各簇
     * 的相对宽度顺序分配，生成独立短语层；图标与窄竖线不占文字宽度。
     */
    function splitIconMixedOcrLine(line) {
      var segments = line && line.visualTextSegments
        ? line.visualTextSegments.slice()
        : [];
      var originalText = String(line && line.text || "")
        .replace(/[|丨┃¦]/g, "")
        .replace(/\s+/g, "")
        .trim();
      if (segments.length < 2 || segments.length > 24 || !line.box) {
        return [line];
      }

      if (shouldKeepLargeSentenceMerged(line, segments)) {
        line.visualTextSegments = null;
        return [line];
      }

      segments.sort(function (left, right) {
        return left.x - right.x;
      });
      var segmentTexts = segments.map(function (segment) {
        return String(segment.text || "").replace(/\s+/g, "");
      });
      if (segmentTexts.join("") !== originalText) {
        var partition = partitionOcrTextBySegments(originalText, segments);
        if (!partition || partition.join("") !== originalText) return [line];
        segmentTexts = partition;
      }

      var output = [];
      segments.forEach(function (segment, index) {
        var partText = segmentTexts[index];
        if (!partText) return;
        var part = copyOcrLine(line, partText, {
          x: Number(segment.x) || 0,
          y: Number(segment.y) || 0,
          width: Math.max(1, Number(segment.width) || 1),
          height: Math.max(1, Number(segment.height) || 1)
        }, segment.styleSplit ? "visual-style" : "visual-gap", 1);
        part.color = normalizeHexColor(segment.color) || line.color;
        part.fontHeight = Number(segment.fontHeight) || part.box.height;
        part.weight = segment.weight || line.weight;
        part.weightScore = Number(segment.weightScore) || 0;
        part.letterSpacing = isFinite(Number(segment.letterSpacing))
          ? Number(segment.letterSpacing)
          : null;
        part.fontFamily = segment.fontFamily || line.fontFamily || "";
        part.fontStyle = segment.fontStyle || line.fontStyle;
        part.boxSource = segment.styleSplit
          ? "image-style-segment"
          : "image-gap-segment";
        part.visualTextSegments = null;
        output.push(part);
      });

      return output.length === segments.length ? output : [line];
    }


    function splitIconMixedOcrLines(lines) {
      var output = [];
      (lines || []).forEach(function (line) {
        splitIconMixedOcrLine(line).forEach(function (part) {
          output.push(part);
        });
      });
      return output;
    }

    /*
     * 同一视觉行、同色同字重且高度接近的短语通常来自同一套文字样式。
     * OCR 框会因具体汉字笔画不同产生少量高度波动，这里使用中位数作为
     * Photoshop 字号拟合高度；保留每个短语自己的位置和擦除边界。
     */
    function normalizeOcrTypographyHeights(lines) {
      var output = lines || [];
      var rows = [];
      output.forEach(function (line) {
        var chosen = null;
        rows.forEach(function (row) {
          if (!chosen && sameOcrVisualRow(row, line)) chosen = row;
        });
        if (!chosen) {
          chosen = {
            top: line.box.y,
            bottom: line.box.y + line.box.height,
            height: line.box.height,
            items: []
          };
          rows.push(chosen);
        }
        chosen.items.push(line);
        chosen.top = Math.min(chosen.top, line.box.y);
        chosen.bottom = Math.max(
          chosen.bottom,
          line.box.y + line.box.height
        );
        chosen.height = Math.max(1, chosen.bottom - chosen.top);
      });

      rows.forEach(function (row) {
        var remaining = row.items.slice();
        while (remaining.length) {
          var seed = remaining.shift();
          var family = [seed];
          var next = [];
          remaining.forEach(function (candidate) {
            var heightRatio = Math.abs(
              candidate.box.height - seed.box.height
            ) / Math.max(1, Math.max(
              candidate.box.height,
              seed.box.height
            ));
            if (
              candidate.fontStyle === seed.fontStyle &&
              candidate.weight === seed.weight &&
              (!normalizedOcrFontFamily(candidate) ||
                !normalizedOcrFontFamily(seed) ||
                normalizedOcrFontFamily(candidate) ===
                  normalizedOcrFontFamily(seed)) &&
              ocrColorDistance(candidate.color, seed.color) <= 38 &&
              Math.abs((Number(candidate.weightScore) || 0) -
                (Number(seed.weightScore) || 0)) <= 0.055 &&
              heightRatio <= 0.17
            ) {
              family.push(candidate);
            } else {
              next.push(candidate);
            }
          });
          remaining = next;
          if (family.length < 2) {
            seed.fontHeight = seed.box.height;
            continue;
          }
          var heights = family.map(function (item) {
            return Number(item.box.height) || 1;
          }).sort(function (left, right) {
            return left - right;
          });
          var middle = Math.floor(heights.length / 2);
          var median = heights.length % 2
            ? heights[middle]
            : (heights[middle - 1] + heights[middle]) / 2;
          family.forEach(function (item) {
            item.fontHeight = median;
          });
        }
      });
      return output;
    }

    /*
     * PaddleOCR 经常把“115名”“20台”“99%”识别成一个整行框，
     * 但原图中的单位实际明显小于数字。这里仅对明确的数字+单位
     * 组合拆分，避免把普通中文标题误拆成多个图层。
     */
    function splitMixedSizeLine(line) {
      if (line && (line.tableCell || line.tableLayout)) return [line];
      var text = String(line && line.text || "").trim();
      var match = text.match(
        /^([¥￥$€£]?[+\-]?\d[\d,.:\-\/]*)(\s*(?:小时|分钟|名|人|位|台|套|项|款|种|家|件|个|年|月|天|秒|㎡|m²|cm|mm|kg|g|吨|%|％|\+))$/i
      );
      if (!match || !line.box) return [line];

      var primaryText = String(match[1] || "").trim();
      var unitText = String(match[2] || "").trim();
      if (!primaryText || !unitText) return [line];

      var box = line.box;
      var primaryHeight = Math.max(1, box.height);
      var unitScale = /^[%％+]$/.test(unitText) ? 0.56 : 0.48;
      var unitHeight = Math.max(1, primaryHeight * unitScale);
      var gap = Math.max(0, primaryHeight * 0.045);
      var primaryNatural = glyphWidthWeight(primaryText) * primaryHeight;
      var unitNatural = glyphWidthWeight(unitText) * unitHeight;
      var availableWidth = Math.max(2, box.width - gap);
      var naturalTotal = Math.max(1, primaryNatural + unitNatural);
      var primaryWidth = availableWidth * primaryNatural / naturalTotal;
      var unitWidth = Math.max(1, availableWidth - primaryWidth);

      return [
        copyOcrLine(line, primaryText, {
          x: box.x,
          y: box.y,
          width: Math.max(1, primaryWidth),
          height: primaryHeight
        }, "primary", 1),
        copyOcrLine(line, unitText, {
          x: box.x + primaryWidth + gap,
          y: box.y + primaryHeight - unitHeight,
          width: unitWidth,
          height: unitHeight
        }, "unit", unitScale)
      ];
    }

    function expandTypographyLines(lines) {
      var output = [];
      (lines || []).slice().sort(function (left, right) {
        return left.box.y - right.box.y || left.box.x - right.box.x;
      }).forEach(function (line) {
        splitMixedSizeLine(line).forEach(function (part) {
          if (part.text) output.push(part);
        });
      });
      return output;
    }

    function ocrBoxOverlapRatio(left, right) {
      if (!left || !right) return 0;
      var overlapWidth = Math.max(0, Math.min(
        left.x + left.width, right.x + right.width
      ) - Math.max(left.x, right.x));
      var overlapHeight = Math.max(0, Math.min(
        left.y + left.height, right.y + right.height
      ) - Math.max(left.y, right.y));
      var overlap = overlapWidth * overlapHeight;
      var smaller = Math.max(1, Math.min(
        left.width * left.height, right.width * right.height
      ));
      return overlap / smaller;
    }

    function normalizedOcrTextValue(value) {
      return String(value || "").replace(/\s+/g, "").replace(/[·•・]/g, "·");
    }

    function mergeSmallTextRecovery(primaryLines, recoveredLines) {
      var output = (primaryLines || []).slice();
      (recoveredLines || []).forEach(function (candidate) {
        var text = normalizedOcrTextValue(candidate.text);
        var readableLength = ocrTextCharacters(text).length;
        if (!isReadableOcrText(text) || readableLength < 2) return;
        if ((Number(candidate.score) || 0) < (readableLength >= 4 ? 0.34 : 0.56)) return;
        var duplicate = output.some(function (existing) {
          var existingText = normalizedOcrTextValue(existing.text);
          var overlap = ocrBoxOverlapRatio(existing.box, candidate.box);
          if (overlap >= 0.48) return true;
          if (existingText === text && overlap >= 0.18) return true;
          if (overlap >= 0.32 && (
            existingText.indexOf(text) >= 0 || text.indexOf(existingText) >= 0
          )) return true;
          return false;
        });
        if (duplicate) return;
        candidate.smallTextRecovery = true;
        candidate.boxSource = "small-text-recovery";
        output.push(candidate);
      });
      return output.sort(function (left, right) {
        return left.box.y - right.box.y || left.box.x - right.box.x;
      });
    }

    /*
     * 稀疏海报常把顶部胶囊标签等小字漏掉。主识别结果较少时，对尺寸
     * 可控的当前图片做一次 1.5~2.2 倍增强识别，再按坐标映射回原图。
     * 与现有文字框重叠的结果全部去重，因此不会重复生成主标题。
     */
    function recoverSmallOcrLines(result, imageBase64) {
      var primary = result && result.lines ? result.lines : [];
      if (!imageBase64 || primary.length > 5 || typeof Image === "undefined") {
        return Promise.resolve(primary);
      }
      var primaryHeights = primary.map(function (line) {
        return Number(line && line.box && line.box.height) || 0;
      }).filter(function (heightValue) { return heightValue > 0; });
      var primaryMedianHeight = ocrMedian(primaryHeights, 0);
      var alreadyHasSmallLabel = primary.some(function (line) {
        var textLength = ocrTextCharacters(line && line.text).length;
        var lineHeight = Number(line && line.box && line.box.height) || 0;
        return textLength >= 4 && primaryMedianHeight > 0 &&
          lineHeight <= primaryMedianHeight * 0.64;
      });
      if (alreadyHasSmallLabel) return Promise.resolve(primary);
      return loadBase64Image(imageBase64, "OCR 小字增强图片").then(function (image) {
        var width = Math.max(1, image.naturalWidth || image.width || 1);
        var height = Math.max(1, image.naturalHeight || image.height || 1);
        if (width * height > 8000000 || height > 5000) return primary;
        var scale = Math.min(
          2.2,
          1800 / width,
          5000 / height
        );
        if (scale < 1.45) return primary;
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        var context = canvas.getContext("2d");
        if (!context) return primary;
        try { context.imageSmoothingEnabled = true; } catch (ignoreSmoothing) {}
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var enhancedBase64 = canvasPngBase64(canvas);
        canvas.width = 1;
        canvas.height = 1;
        try { image.src = ""; } catch (ignoreReleaseImage) {}
        setStatus("正在补充识别顶部标签与小字号文字…");
        return ocrRequest({
          image_base64: enhancedBase64,
          filename: "ocr_small_text_" + Date.now() + ".png",
          group: false
        }).then(function (response) {
          var recovered = normalizeOcrResponse(response.response).lines;
          recovered.forEach(function (line) {
            line.box = {
              x: line.box.x / scale,
              y: line.box.y / scale,
              width: line.box.width / scale,
              height: line.box.height / scale
            };
            if (line.fontSize) line.fontSize /= scale;
            if (line.fontHeight) line.fontHeight /= scale;
          });
          return mergeSmallTextRecovery(primary, recovered);
        }).catch(function () {
          return primary;
        });
      }).catch(function () {
        return primary;
      });
    }

      return {
      normalizeOcrBox: normalizeOcrBox,
      normalizeHexColor: normalizeHexColor,
      colorDistance: colorDistance,
      rgbHex: rgbHex,
      quantizedColorKey: quantizedColorKey,
      addColorSample: addColorSample,
      bucketRgb: bucketRgb,
      dominantColor: dominantColor,
      ocrPercentile: ocrPercentile,
      rgbLuminance: rgbLuminance,
      dominantCoreForeground: dominantCoreForeground,
      refineOcrStrokeColor: refineOcrStrokeColor,
      ocrMedian: ocrMedian,
      ocrMad: ocrMad,
      ocrAverageRgb: ocrAverageRgb,
      ocrTextCharacters: ocrTextCharacters,
      ocrCharacterWeight: ocrCharacterWeight,
      ocrTextWeightRange: ocrTextWeightRange,
      partitionOcrTextBySegments: partitionOcrTextBySegments,
      ocrColumnGapStats: ocrColumnGapStats,
      analyzeOcrSegmentPixels: analyzeOcrSegmentPixels,
      refineOcrCharacterBoundary: refineOcrCharacterBoundary,
      ocrMetricWindow: ocrMetricWindow,
      stabilizeOcrCharacterMetrics: stabilizeOcrCharacterMetrics,
      ocrMetricToWindowDistance: ocrMetricToWindowDistance,
      normalizeOcrBreakCandidates: normalizeOcrBreakCandidates,
      classifyOcrWeight: classifyOcrWeight,
      splitVisualSegmentByStyle: splitVisualSegmentByStyle,
      enhanceOcrVisualSegments: enhanceOcrVisualSegments,
      tightenOcrBoxToTextCluster: tightenOcrBoxToTextCluster,
      medianPositive: medianPositive,
      explicitOcrFontStyle: explicitOcrFontStyle,
      ocrCharacterPixelSlots: ocrCharacterPixelSlots,
      measureOcrCharacterStrokes: measureOcrCharacterStrokes,
      inferOcrFontStyleFromPixels: inferOcrFontStyleFromPixels,
      analyzeOcrLineAppearance: analyzeOcrLineAppearance,
      analyzeOcrAppearance: analyzeOcrAppearance,
      normalizeOcrResponse: normalizeOcrResponse,
      glyphWidthWeight: glyphWidthWeight,
      copyOcrLine: copyOcrLine,
      ocrHexRgb: ocrHexRgb,
      ocrColorDistance: ocrColorDistance,
      isReadableOcrText: isReadableOcrText,
      isLikelyIconOcrLine: isLikelyIconOcrLine,
      sameOcrVisualRow: sameOcrVisualRow,
      textJoiner: textJoiner,
      normalizedOcrFontFamily: normalizedOcrFontFamily,
      ocrFragmentStyleCompatible: ocrFragmentStyleCompatible,
      rowOcrGapContext: rowOcrGapContext,
      canMergeOcrFragments: canMergeOcrFragments,
      mergeOcrFragments: mergeOcrFragments,
      ocrLineStyleDistance: ocrLineStyleDistance,
      mergeOcrFragmentsUsingStyle: mergeOcrFragmentsUsingStyle,
      canCollapseOcrSentencePair: canCollapseOcrSentencePair,
      collapseUniformOcrSentenceRow: collapseUniformOcrSentenceRow,
      suppressOcrSingletonFragments: suppressOcrSingletonFragments,
      buildOcrVisualRows: buildOcrVisualRows,
      detectOcrTableLayout: detectOcrTableLayout,
      markOcrTableLayoutHints: markOcrTableLayoutHints,
      tableCellJoiner: tableCellJoiner,
      dominantOcrCellValue: dominantOcrCellValue,
      mergeOcrTableCellItems: mergeOcrTableCellItems,
      groupOcrTableCells: groupOcrTableCells,
      groupOcrTextFragments: groupOcrTextFragments,
      shouldKeepLargeSentenceMerged: shouldKeepLargeSentenceMerged,
      splitIconMixedOcrLine: splitIconMixedOcrLine,
      splitIconMixedOcrLines: splitIconMixedOcrLines,
      normalizeOcrTypographyHeights: normalizeOcrTypographyHeights,
      splitMixedSizeLine: splitMixedSizeLine,
      expandTypographyLines: expandTypographyLines,
      ocrBoxOverlapRatio: ocrBoxOverlapRatio,
      normalizedOcrTextValue: normalizedOcrTextValue,
      mergeSmallTextRecovery: mergeSmallTextRecovery,
      recoverSmallOcrLines: recoverSmallOcrLines
      };
    }
  };
}(window));
