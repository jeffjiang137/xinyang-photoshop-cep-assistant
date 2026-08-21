(function (global) {
  "use strict";

  if (global.XinyangSmartSliceAnalyzer) return;

  global.XinyangSmartSliceAnalyzer = {
    create: function (deps) {
      deps = deps || {};


    function slicePercentile(values, ratio) {
      if (!values || !values.length) return 0;
      var sorted = values.slice().sort(function (left, right) {
        return left - right;
      });
      var index = Math.max(
        0,
        Math.min(
          sorted.length - 1,
          Math.round((sorted.length - 1) * ratio)
        )
      );
      return Number(sorted[index]) || 0;
    }

    function smartSliceHintData(meta) {
      var width = Math.max(1, Number(meta.width) || 1);
      var height = Math.max(1, Number(meta.height) || 1);
      var raw = meta.layerHints || [];
      var hints = [];
      var index;

      for (index = 0; index < raw.length; index += 1) {
        var hint = raw[index] || {};
        var left = Math.max(0, Number(hint.left) || 0);
        var top = Math.max(0, Number(hint.top) || 0);
        var hintWidth = Math.max(0, Number(hint.width) || 0);
        var hintHeight = Math.max(0, Number(hint.height) || 0);
        if (!(hintWidth > 2 && hintHeight > 2)) continue;
        if (
          hintWidth >= width * 0.96 &&
          hintHeight >= height * 0.68
        ) {
          continue;
        }
        if (hintHeight >= height * 0.78) continue;
        hints.push({
          id: Number(hint.id),
          name: String(hint.name || ""),
          kind: String(hint.kind || "image"),
          atomic: !!hint.atomic,
          depth: Number(hint.depth) || 0,
          parentId: Number(hint.parentId),
          left: left,
          top: top,
          width: hintWidth,
          height: hintHeight,
          bottom: Math.min(height, top + hintHeight)
        });
      }

      hints.sort(function (leftHint, rightHint) {
        return leftHint.top - rightHint.top ||
          leftHint.left - rightHint.left;
      });

      var protectedRanges = [];
      var structuralCandidates = [];
      for (index = 0; index < hints.length; index += 1) {
        var current = hints[index];
        protectedRanges.push({
          top: current.top,
          bottom: current.bottom,
          strength: current.atomic ? 3 : 1,
          type: current.kind === "text" ? "text" : "layer",
          padding: current.kind === "text"
            ? Math.max(12, width * 0.035)
            : Math.max(6, width * 0.014)
        });
        if (
          current.atomic ||
          (
            current.depth === 0 &&
            current.kind !== "text" &&
            current.width >= width * 0.68 &&
            current.height >= width * 0.22
          )
        ) {
          structuralCandidates.push({
            y: current.bottom,
            score: current.atomic ? 180 : 105,
            priority: 2,
            source: "layer"
          });
        }
      }

      /*
       * 短文字图层通常是标题或小标题。若它下方在合理距离内紧跟
       * 图片、形状或完整分组，则把二者联合保护，避免标题与对应内容
       * 被切到两个切片中。
       */
      for (index = 0; index < hints.length; index += 1) {
        var title = hints[index];
        if (
          title.kind !== "text" ||
          title.height > width * 0.32
        ) {
          continue;
        }
        var nextVisual = null;
        var nextIndex;
        for (
          nextIndex = index + 1;
          nextIndex < hints.length;
          nextIndex += 1
        ) {
          var candidate = hints[nextIndex];
          if (candidate.top < title.bottom - 2) continue;
          var gap = candidate.top - title.bottom;
          if (gap > width * 0.24) break;
          var overlap = Math.max(
            0,
            Math.min(
              title.left + title.width,
              candidate.left + candidate.width
            ) - Math.max(title.left, candidate.left)
          );
          var overlapRatio = overlap / Math.max(
            1,
            Math.min(title.width, candidate.width)
          );
          if (
            candidate.kind !== "text" &&
            overlapRatio >= 0.28 &&
            candidate.height <= width * 2.4
          ) {
            nextVisual = candidate;
            break;
          }
        }
        if (nextVisual) {
          protectedRanges.push({
            top: title.top,
            bottom: nextVisual.bottom,
            strength: 4,
            type: "association",
            padding: Math.max(12, width * 0.025)
          });
        }
      }

      /*
       * 产品图与其下方/叠放的按钮、标签必须作为一个整体保护。按钮可能
       * 是文字层、形状层，或二者分开存在；优先用名称识别，名称不明确时
       * 再以“小尺寸 + 同父组 + 横向重叠 + 近距离”判断。
       */
      for (index = 0; index < hints.length; index += 1) {
        var visual = hints[index];
        if (
          visual.kind === "text" ||
          visual.height < width * 0.16 ||
          visual.width < width * 0.12
        ) {
          continue;
        }
        var visualBottom = visual.bottom;
        var linkedBottom = visualBottom;
        var linked = false;
        var linkIndex;
        for (linkIndex = 0; linkIndex < hints.length; linkIndex += 1) {
          if (linkIndex === index) continue;
          var control = hints[linkIndex];
          if (
            control.kind !== "text" &&
            control.kind !== "shape"
          ) {
            continue;
          }
          var controlName = String(control.name || "");
          var namedButton = /按钮|下单|订购|购买|查看|咨询|立即|button|btn|order|buy/i.test(
            controlName
          );
          var sameParent = (
            isFinite(visual.parentId) &&
            isFinite(control.parentId) &&
            visual.parentId === control.parentId
          );
          var verticalGap = control.top - visualBottom;
          var verticallyRelated = (
            verticalGap >= -width * 0.1 &&
            verticalGap <= width * 0.16
          );
          var horizontalOverlap = Math.max(
            0,
            Math.min(
              visual.left + visual.width,
              control.left + control.width
            ) - Math.max(visual.left, control.left)
          );
          var controlOverlap = horizontalOverlap / Math.max(
            1,
            Math.min(visual.width, control.width)
          );
          var compactControl = (
            control.height <= width * 0.22 &&
            control.width <= Math.max(width * 0.58, visual.width * 0.92)
          );
          if (
            verticallyRelated &&
            controlOverlap >= 0.3 &&
            compactControl &&
            (namedButton || sameParent)
          ) {
            linkedBottom = Math.max(linkedBottom, control.bottom);
            linked = true;
          }
        }
        if (linked) {
          protectedRanges.push({
            top: visual.top,
            bottom: linkedBottom,
            strength: 5,
            type: "association",
            padding: Math.max(12, width * 0.025)
          });
        }
      }

      return {
        hints: hints,
        protectedRanges: protectedRanges,
        structuralCandidates: structuralCandidates
      };
    }

    function smartSliceCutProtected(y, ranges, width, candidate) {
      var defaultPadding = Math.max(8, width * 0.018);
      var index;
      for (index = 0; index < ranges.length; index += 1) {
        var range = ranges[index];
        /*
         * 真正贯穿画布的整行分割线本身会被像素活动检测标记。它可以
         * 穿过普通像素活动范围，但仍必须服从文字、标题关联、按钮关联
         * 和 PSD 图层边界保护。
         */
        if (
          candidate &&
          candidate.source === "full-width-transition" &&
          range.type === "pixel"
        ) {
          continue;
        }
        var padding = isFinite(Number(range.padding))
          ? Math.max(0, Number(range.padding))
          : defaultPadding;
        var paddingTop = isFinite(Number(range.paddingTop))
          ? Math.max(0, Number(range.paddingTop))
          : padding;
        var paddingBottom = isFinite(Number(range.paddingBottom))
          ? Math.max(0, Number(range.paddingBottom))
          : padding;
        if (
          y > range.top - paddingTop &&
          y < range.bottom + paddingBottom
        ) {
          return true;
        }
      }
      return false;
    }

    function smartSliceMergeCandidates(candidates, width, height, ranges) {
      var edgeMargin = Math.max(24, width * 0.06);
      var mergeDistance = Math.max(10, width * 0.025);
      var filtered = (candidates || []).filter(function (candidate) {
        return (
          candidate &&
          isFinite(candidate.y) &&
          candidate.y > edgeMargin &&
          candidate.y < height - edgeMargin &&
          !smartSliceCutProtected(
            candidate.y,
            ranges,
            width,
            candidate
          )
        );
      }).sort(function (left, right) {
        return left.y - right.y;
      });
      /*
       * 一级贯穿带或二级 PSD 板块边界附近，不再保留低等级候选。
       * 这样产品卡内部的小留白不会与真正的整屏分割带同时生成参考线。
       */
      var influenceDistance = Math.max(80, width * 0.68);
      filtered = filtered.filter(function (candidate, candidateIndex) {
        var priority = Number(candidate.priority) || 0;
        var strongerIndex;
        for (
          strongerIndex = 0;
          strongerIndex < filtered.length;
          strongerIndex += 1
        ) {
          if (strongerIndex === candidateIndex) continue;
          var stronger = filtered[strongerIndex];
          if (
            (Number(stronger.priority) || 0) > priority &&
            Math.abs(stronger.y - candidate.y) < influenceDistance
          ) {
            return false;
          }
        }
        return true;
      });
      var merged = [];
      var index;
      for (index = 0; index < filtered.length; index += 1) {
        var item = filtered[index];
        if (
          merged.length &&
          item.y - merged[merged.length - 1].y <= mergeDistance
        ) {
          var previous = merged[merged.length - 1];
          var itemPriority = Number(item.priority) || 0;
          var previousPriority = Number(previous.priority) || 0;
          if (
            itemPriority > previousPriority ||
            (
              itemPriority === previousPriority &&
              item.score > previous.score
            )
          ) {
            merged[merged.length - 1] = item;
          }
        } else {
          merged.push(item);
        }
      }
      return merged;
    }

    function smartSliceFallbackCut(
      start,
      end,
      preferred,
      meta,
      rowDetail,
      ranges,
      rowSafe
    ) {
      var width = Number(meta.width) || 1;
      var height = Number(meta.height) || 1;
      var previewHeight = rowDetail.length;
      var searchRadius = width * 0.42;
      var low = Math.max(start + width * 0.42, preferred - searchRadius);
      var high = Math.min(end - width * 0.28, preferred + searchRadius);
      if (high <= low) return 0;

      var lowPreview = Math.max(
        1,
        Math.floor(low * previewHeight / height)
      );
      var highPreview = Math.min(
        previewHeight - 2,
        Math.ceil(high * previewHeight / height)
      );
      var bestY = 0;
      var bestScore = Infinity;
      var previewY;
      for (
        previewY = lowPreview;
        previewY <= highPreview;
        previewY += 1
      ) {
        var y = previewY * height / previewHeight;
        if (smartSliceCutProtected(y, ranges, width)) continue;
        /*
         * 兜底也只能落在接近贯穿画布的安全行上。找不到可靠横向通道时
         * 宁可保留较高切片，不强行切开产品、标题或按钮。
         */
        if (rowSafe && !rowSafe[previewY]) {
          continue;
        }
        var distancePenalty =
          Math.abs(y - preferred) / Math.max(1, width) * 5;
        var score = rowDetail[previewY] + distancePenalty;
        if (score < bestScore) {
          bestScore = score;
          bestY = y;
        }
      }
      return bestY ? Math.round(bestY) : 0;
    }

    function smartSliceFindHardLimitCut(
      start,
      end,
      preferred,
      remainingPieces,
      meta,
      rowDetail,
      ranges,
      rowSafe
    ) {
      // Smart-slice boundaries must remain visibly separated. Keep this in sync
      // with the Photoshop-side guard, which is the final authority before guides
      // and slices are created.
      var minimumGap = 200;
      var maximumGap = 2500;
      var height = Math.max(1, Number(meta.height) || 1);
      var width = Math.max(1, Number(meta.width) || 1);
      var previewHeight = rowDetail && rowDetail.length
        ? rowDetail.length
        : 0;
      var low = Math.max(
        start + minimumGap,
        end - remainingPieces * maximumGap
      );
      var high = Math.min(
        start + maximumGap,
        end - remainingPieces * minimumGap
      );
      if (high < low) {
        return Math.round(Math.max(
          start + minimumGap,
          Math.min(end - minimumGap, preferred)
        ));
      }
      preferred = Math.max(low, Math.min(high, preferred));
      if (!previewHeight) return Math.round(preferred);

      var lowPreview = Math.max(
        1,
        Math.floor(low * previewHeight / height)
      );
      var highPreview = Math.min(
        previewHeight - 2,
        Math.ceil(high * previewHeight / height)
      );
      var bestY = 0;
      var bestScore = Infinity;
      var pass;
      for (pass = 0; pass < 2; pass += 1) {
        var previewY;
        for (
          previewY = lowPreview;
          previewY <= highPreview;
          previewY += 1
        ) {
          if (pass === 0 && rowSafe && !rowSafe[previewY]) continue;
          var y = previewY * height / previewHeight;
          if (smartSliceCutProtected(y, ranges, width)) continue;
          var detail = Number(rowDetail[previewY]);
          if (!isFinite(detail)) detail = 0;
          var score = detail +
            Math.abs(y - preferred) / Math.max(1, width) * 8;
          if (score < bestScore) {
            bestScore = score;
            bestY = y;
          }
        }
        if (bestY) break;
      }
      return Math.round(bestY || preferred);
    }

    function enforceSmartSliceBoundarySpacing(
      boundaries,
      meta,
      rowDetail,
      ranges,
      rowSafe
    ) {
      // Includes the canvas top/bottom edges so the first and last slices also
      // cannot become narrow slivers.
      var minimumGap = 200;
      var maximumGap = 2500;
      var height = Math.max(1, Math.round(Number(meta.height) || 1));
      var normalized = (boundaries || []).map(function (value) {
        return Math.max(0, Math.min(height, Math.round(Number(value) || 0)));
      }).sort(function (left, right) {
        return left - right;
      });
      if (!normalized.length || normalized[0] !== 0) normalized.unshift(0);
      if (normalized[normalized.length - 1] !== height) normalized.push(height);

      var compact = [0];
      var index;
      for (index = 1; index < normalized.length - 1; index += 1) {
        var current = normalized[index];
        if (current - compact[compact.length - 1] < minimumGap) continue;
        compact.push(current);
      }
      if (
        compact.length > 1 &&
        height - compact[compact.length - 1] < minimumGap
      ) {
        compact.pop();
      }
      compact.push(height);

      var output = [compact[0]];
      for (index = 1; index < compact.length; index += 1) {
        var segmentStart = output[output.length - 1];
        var segmentEnd = compact[index];
        var span = segmentEnd - segmentStart;
        if (span > maximumGap) {
          var pieces = Math.ceil(span / maximumGap);
          var pieceIndex;
          for (pieceIndex = 1; pieceIndex < pieces; pieceIndex += 1) {
            var remainingPieces = pieces - pieceIndex;
            var ideal = segmentStart + span * pieceIndex / pieces;
            var cut = smartSliceFindHardLimitCut(
              output[output.length - 1],
              segmentEnd,
              ideal,
              remainingPieces,
              meta,
              rowDetail,
              ranges,
              rowSafe
            );
            cut = Math.max(
              output[output.length - 1] + minimumGap,
              Math.min(
                segmentEnd - remainingPieces * minimumGap,
                cut
              )
            );
            if (cut - output[output.length - 1] > maximumGap) {
              cut = output[output.length - 1] + maximumGap;
            }
            output.push(Math.round(cut));
          }
        }
        if (segmentEnd > output[output.length - 1]) output.push(segmentEnd);
      }
      return output;
    }

    function smartSliceChooseBoundaries(
      meta,
      candidates,
      rowDetail,
      ranges,
      rowSafe
    ) {
      var width = Math.max(1, Number(meta.width) || 1);
      var height = Math.max(2, Number(meta.height) || 2);
      var minimum = Math.max(220, width * 0.48);
      var preferred = Math.min(2500, Math.max(620, width * 1.55));
      var maximum = Math.min(2500, Math.max(980, width * 2.65));
      var merged = smartSliceMergeCandidates(
        candidates,
        width,
        height,
        ranges
      );
      var selected = [0];
      var cursor = 0;

      /*
       * 相距不足一个最小板块高度的候选视为同一区域，只保留更可靠
       * 的切口，避免正文行距或卡片内部留白生成过多小切片。
       */
      while (cursor < merged.length) {
        var best = merged[cursor];
        var clusterStartY = merged[cursor].y;
        var clusterEnd = cursor + 1;
        while (
          clusterEnd < merged.length &&
          merged[clusterEnd].y - clusterStartY < minimum
        ) {
          var clusterPriority =
            Number(merged[clusterEnd].priority) || 0;
          var bestPriority = Number(best.priority) || 0;
          if (
            clusterPriority > bestPriority ||
            (
              clusterPriority === bestPriority &&
              merged[clusterEnd].score > best.score
            )
          ) {
            best = merged[clusterEnd];
          }
          clusterEnd += 1;
        }
        if (best.y - selected[selected.length - 1] >= minimum) {
          selected.push(Math.round(best.y));
        }
        cursor = clusterEnd;
      }

      var expanded = [0];
      var selectedIndex;
      for (
        selectedIndex = 1;
        selectedIndex <= selected.length;
        selectedIndex += 1
      ) {
        var nextBoundary = selectedIndex < selected.length
          ? selected[selectedIndex]
          : height;
        var last = expanded[expanded.length - 1];
        while (nextBoundary - last > maximum) {
          var desired = Math.min(
            nextBoundary - minimum,
            last + preferred
          );
          var inserted = smartSliceFallbackCut(
            last,
            nextBoundary,
            desired,
            meta,
            rowDetail,
            ranges,
            rowSafe
          );
          if (!inserted || inserted - last < minimum * 0.72) break;
          expanded.push(inserted);
          last = inserted;
        }
        if (nextBoundary > last) expanded.push(nextBoundary);
      }

      if (
        expanded.length > 2 &&
        height - expanded[expanded.length - 2] < width * 0.22
      ) {
        expanded.splice(expanded.length - 2, 1);
      }

      var output = [];
      for (selectedIndex = 0; selectedIndex < expanded.length; selectedIndex += 1) {
        var value = Math.max(
          0,
          Math.min(height, Math.round(expanded[selectedIndex]))
        );
        if (!output.length || value > output[output.length - 1]) {
          output.push(value);
        }
      }
      if (!output.length || output[0] !== 0) output.unshift(0);
      if (output[output.length - 1] !== height) output.push(height);
      return enforceSmartSliceBoundarySpacing(
        output,
        meta,
        rowDetail,
        ranges,
        rowSafe
      );
    }

    function analyzeSmartSliceImage(imageBase64, meta) {
      return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () {
          try {
            var canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            var context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            var width = canvas.width;
            var height = canvas.height;
            var imageData = context.getImageData(
              0,
              0,
              width,
              height
            ).data;
            var rowHorizontal = [];
            var rowVertical = [];
            var rowDetail = [];
            var rowRed = [];
            var rowGreen = [];
            var rowBlue = [];
            var tileCount = Math.max(
              8,
              Math.min(24, Math.round(width / 24))
            );
            var rowTileDetail = [];
            var rowTileVertical = [];
            var rowTransitionMagnitude = [];
            var rowTransitionConsistency = [];
            var y;

            for (y = 0; y < height; y += 1) {
              var horizontal = 0;
              var vertical = 0;
              var red = 0;
              var green = 0;
              var blue = 0;
              var tileTotals = [];
              var tileVerticalTotals = [];
              var tileDeltaRedTotals = [];
              var tileDeltaGreenTotals = [];
              var tileDeltaBlueTotals = [];
              var tilePixels = [];
              var tileSeed;
              for (tileSeed = 0; tileSeed < tileCount; tileSeed += 1) {
                tileTotals[tileSeed] = 0;
                tileVerticalTotals[tileSeed] = 0;
                tileDeltaRedTotals[tileSeed] = 0;
                tileDeltaGreenTotals[tileSeed] = 0;
                tileDeltaBlueTotals[tileSeed] = 0;
                tilePixels[tileSeed] = 0;
              }
              var x;
              for (x = 0; x < width; x += 1) {
                var offset = (y * width + x) * 4;
                var r = imageData[offset];
                var g = imageData[offset + 1];
                var b = imageData[offset + 2];
                var horizontalDelta = 0;
                var verticalDelta = 0;
                red += r;
                green += g;
                blue += b;
                if (x > 0) {
                  horizontalDelta = (
                    Math.abs(r - imageData[offset - 4]) +
                    Math.abs(g - imageData[offset - 3]) +
                    Math.abs(b - imageData[offset - 2])
                  ) / 3;
                  horizontal += horizontalDelta;
                }
                if (y > 0) {
                  var above = offset - width * 4;
                  verticalDelta = (
                    Math.abs(r - imageData[above]) +
                    Math.abs(g - imageData[above + 1]) +
                    Math.abs(b - imageData[above + 2])
                  ) / 3;
                  vertical += verticalDelta;
                }
                var tileIndex = Math.min(
                  tileCount - 1,
                  Math.floor(x * tileCount / Math.max(1, width))
                );
                tileTotals[tileIndex] += (
                  horizontalDelta * 0.62 +
                  verticalDelta * 0.38
                );
                tileVerticalTotals[tileIndex] += verticalDelta;
                if (y > 0) {
                  tileDeltaRedTotals[tileIndex] +=
                    r - imageData[above];
                  tileDeltaGreenTotals[tileIndex] +=
                    g - imageData[above + 1];
                  tileDeltaBlueTotals[tileIndex] +=
                    b - imageData[above + 2];
                }
                tilePixels[tileIndex] += 1;
              }
              rowHorizontal[y] = horizontal / Math.max(1, width - 1);
              rowVertical[y] = vertical / Math.max(1, width);
              rowRed[y] = red / width;
              rowGreen[y] = green / width;
              rowBlue[y] = blue / width;
              rowTileDetail[y] = [];
              rowTileVertical[y] = [];
              var tileDeltaVectors = [];
              var globalDeltaRed = 0;
              var globalDeltaGreen = 0;
              var globalDeltaBlue = 0;
              for (tileSeed = 0; tileSeed < tileCount; tileSeed += 1) {
                var tilePixelCount = Math.max(
                  1,
                  tilePixels[tileSeed]
                );
                rowTileDetail[y][tileSeed] =
                  tileTotals[tileSeed] /
                  tilePixelCount;
                rowTileVertical[y][tileSeed] =
                  tileVerticalTotals[tileSeed] /
                  tilePixelCount;
                var deltaVector = {
                  red: tileDeltaRedTotals[tileSeed] / tilePixelCount,
                  green: tileDeltaGreenTotals[tileSeed] / tilePixelCount,
                  blue: tileDeltaBlueTotals[tileSeed] / tilePixelCount
                };
                tileDeltaVectors[tileSeed] = deltaVector;
                globalDeltaRed += deltaVector.red;
                globalDeltaGreen += deltaVector.green;
                globalDeltaBlue += deltaVector.blue;
              }
              globalDeltaRed /= tileCount;
              globalDeltaGreen /= tileCount;
              globalDeltaBlue /= tileCount;
              rowTransitionMagnitude[y] = Math.sqrt(
                (
                  globalDeltaRed * globalDeltaRed +
                  globalDeltaGreen * globalDeltaGreen +
                  globalDeltaBlue * globalDeltaBlue
                ) / 3
              );
              var transitionVariance = 0;
              for (tileSeed = 0; tileSeed < tileCount; tileSeed += 1) {
                var tileDelta = tileDeltaVectors[tileSeed];
                transitionVariance += (
                  Math.pow(tileDelta.red - globalDeltaRed, 2) +
                  Math.pow(tileDelta.green - globalDeltaGreen, 2) +
                  Math.pow(tileDelta.blue - globalDeltaBlue, 2)
                ) / 3;
              }
              rowTransitionConsistency[y] = Math.sqrt(
                transitionVariance / tileCount
              );
            }

            for (y = 0; y < height; y += 1) {
              var detailTotal = 0;
              var detailCount = 0;
              var smoothY;
              for (
                smoothY = Math.max(0, y - 2);
                smoothY <= Math.min(height - 1, y + 2);
                smoothY += 1
              ) {
                detailTotal += (
                  rowHorizontal[smoothY] * 0.62 +
                  rowVertical[smoothY] * 0.38
                );
                detailCount += 1;
              }
              rowDetail[y] = detailTotal / Math.max(1, detailCount);
            }

            var horizontalThreshold = Math.min(
              12,
              Math.max(
                3.2,
                slicePercentile(rowHorizontal, 0.38) * 1.75
              )
            );
            var verticalThreshold = Math.min(
              16,
              Math.max(
                4.5,
                slicePercentile(rowVertical, 0.38) * 1.9
              )
            );
            var originalWidth = Math.max(1, Number(meta.width) || 1);
            var originalHeight = Math.max(1, Number(meta.height) || 1);
            var minQuietOriginal = Math.max(
              10,
              originalWidth * 0.016
            );
            var minQuietPreview = Math.max(
              2,
              Math.round(
                minQuietOriginal * height / originalHeight
              )
            );
            var quiet = [];
            var fullWidthQuiet = [];
            var rowQuietCoverage = [];
            var rowActiveCoverage = [];
            var rowFullWidthTransition = [];
            var tileQuietThreshold = Math.min(
              18,
              Math.max(
                5.5,
                (
                  horizontalThreshold * 0.62 +
                  verticalThreshold * 0.38
                ) * 1.25
              )
            );
            var fullWidthTransitionThreshold = Math.max(
              8,
              verticalThreshold * 1.35
            );
            for (y = 0; y < height; y += 1) {
              var quietTiles = 0;
              var transitionTiles = 0;
              var coverageIndex;
              for (
                coverageIndex = 0;
                coverageIndex < tileCount;
                coverageIndex += 1
              ) {
                if (
                  rowTileDetail[y][coverageIndex] <=
                  tileQuietThreshold
                ) {
                  quietTiles += 1;
                }
                if (
                  rowTileVertical[y][coverageIndex] >=
                  fullWidthTransitionThreshold
                ) {
                  transitionTiles += 1;
                }
              }
              rowQuietCoverage[y] =
                quietTiles / Math.max(1, tileCount);
              rowActiveCoverage[y] =
                1 - rowQuietCoverage[y];
              quiet[y] = (
                rowQuietCoverage[y] >= 0.72 &&
                rowHorizontal[y] <= horizontalThreshold &&
                rowVertical[y] <= verticalThreshold
              );
              fullWidthQuiet[y] = (
                quietTiles === tileCount &&
                rowHorizontal[y] <= horizontalThreshold * 0.92 &&
                rowVertical[y] <= verticalThreshold * 0.92
              );
              rowFullWidthTransition[y] = (
                transitionTiles >= Math.max(
                  tileCount - 1,
                  Math.ceil(tileCount * 0.92)
                ) &&
                rowVertical[y] >= fullWidthTransitionThreshold * 0.9 &&
                rowTransitionConsistency[y] <= Math.max(
                  6,
                  rowTransitionMagnitude[y] * 0.35
                )
              );
            }

            var layerData = smartSliceHintData(meta);
            var pixelProtectedRanges = [];
            var activeRows = [];
            var closeIndex;
            for (y = 0; y < height; y += 1) {
              activeRows[y] = (
                !fullWidthQuiet[y] &&
                rowActiveCoverage[y] >= 1 / Math.max(1, tileCount) &&
                (
                  rowHorizontal[y] >= horizontalThreshold * 0.42 ||
                  rowVertical[y] >= verticalThreshold * 0.42
                )
              );
            }
            /*
             * 补齐文字笔画之间的一行小断口，避免同一个标题被拆成多个
             * 活动带。活动带会向上下扩展，切口不能贴着字面、产品边缘
             * 或按钮边缘落下。
             */
            for (closeIndex = 1; closeIndex < height - 1; closeIndex += 1) {
              if (
                !activeRows[closeIndex] &&
                activeRows[closeIndex - 1] &&
                activeRows[closeIndex + 1]
              ) {
                activeRows[closeIndex] = true;
              }
            }
            var activeStart = -1;
            for (y = 0; y <= height; y += 1) {
              if (y < height && activeRows[y]) {
                if (activeStart < 0) activeStart = y;
                continue;
              }
              if (activeStart < 0) continue;
              var activeEnd = y - 1;
              var activeMaxCoverage = 0;
              var activeY;
              for (
                activeY = activeStart;
                activeY <= activeEnd;
                activeY += 1
              ) {
                activeMaxCoverage = Math.max(
                  activeMaxCoverage,
                  rowActiveCoverage[activeY]
                );
              }
              var activeTopOriginal =
                activeStart * originalHeight / height;
              var activeBottomOriginal =
                (activeEnd + 1) * originalHeight / height;
              var activeHeightOriginal =
                activeBottomOriginal - activeTopOriginal;
              var relationRadiusPreview = Math.max(
                4,
                Math.round(
                  originalWidth * 0.24 * height / originalHeight
                )
              );
              var transitionAbove = 0;
              var transitionBelow = 0;
              var relationY;
              for (
                relationY = Math.max(
                  0,
                  activeStart - relationRadiusPreview
                );
                relationY < activeStart;
                relationY += 1
              ) {
                if (rowFullWidthTransition[relationY]) {
                  transitionAbove = Math.max(
                    transitionAbove,
                    rowVertical[relationY]
                  );
                }
              }
              for (
                relationY = activeEnd + 1;
                relationY <= Math.min(
                  height - 1,
                  activeEnd + relationRadiusPreview
                );
                relationY += 1
              ) {
                if (rowFullWidthTransition[relationY]) {
                  transitionBelow = Math.max(
                    transitionBelow,
                    rowVertical[relationY]
                  );
                }
              }
              var blankRowsAbove = 0;
              for (
                relationY = activeStart - 1;
                relationY >= 0 && fullWidthQuiet[relationY];
                relationY -= 1
              ) {
                blankRowsAbove += 1;
              }
              var blankAboveOriginal =
                blankRowsAbove * originalHeight / height;
              pixelProtectedRanges.push({
                top: activeTopOriginal,
                bottom: activeBottomOriginal,
                strength: 2,
                type: "pixel",
                padding: Math.max(7, originalWidth * 0.022)
              });
              /*
               * 局部、较矮的活动带通常是标题、短文案或按钮。除了保护
               * 字面本身，还保护其下方关联区域，避免把“标题 + 配图”
               * 或“产品 + 按钮”从两者之间切开。
               */
              var shortLocalizedBand = (
                activeHeightOriginal >= originalWidth * 0.018 &&
                activeHeightOriginal <= originalWidth * 0.18 &&
                activeMaxCoverage <= 0.72
              );
              var looksLikeHeading = (
                shortLocalizedBand &&
                (
                  transitionAbove >= Math.max(
                    8,
                    transitionBelow * 1.15
                  ) ||
                  blankAboveOriginal >= originalWidth * 0.05
                )
              );
              var looksLikeButton = (
                shortLocalizedBand &&
                !looksLikeHeading &&
                transitionBelow >= Math.max(
                  8,
                  transitionAbove * 1.15
                )
              );
              if (looksLikeHeading) {
                pixelProtectedRanges.push({
                  top: activeTopOriginal,
                  bottom: Math.min(
                    originalHeight,
                    activeBottomOriginal + originalWidth * 0.15
                  ),
                  strength: 4,
                  type: "association",
                  paddingTop: Math.max(2, originalWidth * 0.006),
                  paddingBottom: Math.max(3, originalWidth * 0.01)
                });
              } else if (looksLikeButton) {
                pixelProtectedRanges.push({
                  top: Math.max(
                    0,
                    activeTopOriginal - originalWidth * 0.15
                  ),
                  bottom: activeBottomOriginal,
                  strength: 4,
                  type: "association",
                  paddingTop: Math.max(3, originalWidth * 0.01),
                  paddingBottom: Math.max(2, originalWidth * 0.006)
                });
              }
              activeStart = -1;
            }

            var protectedRanges =
              layerData.protectedRanges.concat(pixelProtectedRanges);
            var candidates = [];
            var runStart = -1;
            var activitySearchPreview = Math.max(
              4,
              Math.round(
                originalWidth * 0.58 * height / originalHeight
              )
            );
            for (y = 0; y <= height; y += 1) {
              if (y < height && fullWidthQuiet[y]) {
                if (runStart < 0) runStart = y;
                continue;
              }
              if (runStart < 0) continue;
              var runEnd = y - 1;
              var runLength = runEnd - runStart + 1;
              if (runLength >= minQuietPreview) {
                var runOriginalHeight =
                  runLength * originalHeight / height;
                var contentAbove = false;
                var contentBelow = false;
                var activityIndex;
                for (
                  activityIndex = Math.max(
                    0,
                    runStart - activitySearchPreview
                  );
                  activityIndex < runStart;
                  activityIndex += 1
                ) {
                  if (activeRows[activityIndex]) {
                    contentAbove = true;
                    break;
                  }
                }
                for (
                  activityIndex = runEnd + 1;
                  activityIndex <= Math.min(
                    height - 1,
                    runEnd + activitySearchPreview
                  );
                  activityIndex += 1
                ) {
                  if (activeRows[activityIndex]) {
                    contentBelow = true;
                    break;
                  }
                }
                if (contentAbove && contentBelow) {
                  var candidatePreviewY =
                    Math.round((runStart + runEnd) / 2);
                  candidates.push({
                    y: candidatePreviewY *
                      originalHeight / height,
                    score: (
                      340 +
                      Math.min(
                        130,
                        runOriginalHeight /
                          Math.max(1, originalWidth) * 820
                      )
                    ),
                    priority: 3,
                    coverage: 1,
                    source: "full-width-band"
                  });
                }
              }
              runStart = -1;
            }

            /*
             * 真正从左到右贯穿画布的横线或背景突变优先级最高。与
             * 只有中心文字或局部图片发生变化的行不同，它要求几乎
             * 每一个横向分块同时出现垂直变化。
             */
            var transitionStart = -1;
            for (y = 0; y <= height; y += 1) {
              if (y < height && rowFullWidthTransition[y]) {
                if (transitionStart < 0) transitionStart = y;
                continue;
              }
              if (transitionStart >= 0) {
                var transitionEnd = y - 1;
                var transitionBest = transitionStart;
                var transitionIndex;
                for (
                  transitionIndex = transitionStart + 1;
                  transitionIndex <= transitionEnd;
                  transitionIndex += 1
                ) {
                  if (
                    rowVertical[transitionIndex] >
                    rowVertical[transitionBest]
                  ) {
                    transitionBest = transitionIndex;
                  }
                }
                candidates.push({
                  y: transitionBest * originalHeight / height,
                  score: 520 + Math.min(
                    180,
                    rowVertical[transitionBest] * 2
                  ),
                  priority: 4,
                  coverage: 1,
                  source: "full-width-transition"
                });
                transitionStart = -1;
              }
            }

            /*
             * PSD 分组边界只用于给附近已经验证安全的整行候选加权，
             * 不再直接把图层 bottom 当成切口，避免图层边界贴着文字
             * 或图片时产生“切字”。
             */
            var snapRadius = originalWidth * 0.22;
            var structuralIndex;
            for (
              structuralIndex = 0;
              structuralIndex < layerData.structuralCandidates.length;
              structuralIndex += 1
            ) {
              var structural =
                layerData.structuralCandidates[structuralIndex];
              var snapped = null;
              var snappedDistance = Infinity;
              var safeIndex;
              for (safeIndex = 0; safeIndex < candidates.length; safeIndex += 1) {
                var distance = Math.abs(
                  candidates[safeIndex].y - structural.y
                );
                if (
                  distance <= snapRadius &&
                  distance < snappedDistance
                ) {
                  snapped = candidates[safeIndex];
                  snappedDistance = distance;
                }
              }
              if (snapped) {
                candidates.push({
                  y: snapped.y,
                  score: snapped.score + Math.min(
                    120,
                    Number(structural.score) || 0
                  ),
                  priority: Math.max(
                    3,
                    Number(snapped.priority) || 0
                  ),
                  coverage: 1,
                  source: snapped.source,
                  layerAligned: true
                });
              }
            }

            var boundaries = smartSliceChooseBoundaries(
              meta,
              candidates,
              rowDetail,
              protectedRanges,
              fullWidthQuiet
            );
            if (boundaries.length < 2) {
              throw new Error("没有找到足够可靠的内容板块切口");
            }
            resolve({
              boundaries: boundaries,
              layerHintCount: layerData.hints.length,
              candidateCount: candidates.length,
              fullWidthCandidateCount: candidates.filter(
                function (candidate) {
                  return candidate.source === "full-width-band";
                }
              ).length
            });
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = function () {
          reject(new Error("无法读取智能切片分析图"));
        };
        image.src = "data:image/png;base64," + imageBase64;
      });
    }

      return {
      slicePercentile: slicePercentile,
      smartSliceHintData: smartSliceHintData,
      smartSliceCutProtected: smartSliceCutProtected,
      smartSliceMergeCandidates: smartSliceMergeCandidates,
      smartSliceFallbackCut: smartSliceFallbackCut,
      smartSliceFindHardLimitCut: smartSliceFindHardLimitCut,
      enforceSmartSliceBoundarySpacing: enforceSmartSliceBoundarySpacing,
      smartSliceChooseBoundaries: smartSliceChooseBoundaries,
      analyzeSmartSliceImage: analyzeSmartSliceImage
      };
    }
  };
}(window));
