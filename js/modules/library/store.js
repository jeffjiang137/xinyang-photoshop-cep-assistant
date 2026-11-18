(function (global) {
  "use strict";
  // The native .Library layout is retained; unknown metadata fields survive edits.
  function create(options) {
    options = options || {};
    var nodeRequire = options.require || (global.cep_node && global.cep_node.require) || (typeof require === "function" && require);
    var fs = options.fs || (nodeRequire && nodeRequire("fs"));
    var path = options.path || (nodeRequire && nodeRequire("path"));
    var BufferType = options.Buffer || (nodeRequire && nodeRequire("buffer").Buffer);
    var snapshots = {};
    var supported = /^(psd|psb|png|jpg|jpeg|jfif|webp|tif|tiff|bmp|gif)$/i;
    var bitmap = /^(png|jpg|jpeg|jfif|webp|bmp|gif)$/i;
    var indexNames = ["Files.json", "Folders.json", "Tag.json"];
    var serial = 0;
    if (!fs || !path) throw new Error("素材库需要 CEP Node 文件访问支持。");

    function fail(message) { throw new Error(message); }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
    function exists(file) { return fs.existsSync(file); }
    function mkdir(dir) { if (!exists(dir)) fs.mkdirSync(dir, { recursive: true }); }
    function uid() {
      var stamp = new Date().getTime().toString(16) + (++serial).toString(16);
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = Math.floor(Math.random() * 16);
        if (stamp.length) { r = (r + parseInt(stamp.charAt(0), 16)) % 16; stamp = stamp.slice(1); }
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      });
    }
    function time() {
      var d = new Date();
      function pad(n) { return n < 10 ? "0" + n : String(n); }
      return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    }
    function validId(id) {
      id = String(id || "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || /^(?:__proto__|prototype|constructor)$/.test(id)) fail("素材或文件夹标识无效。");
      return id;
    }
    function validName(name) {
      name = String(name || "").replace(/^\s+|\s+$/g, "");
      if (!name || name.length > 180 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) fail("名称不能为空，且不能包含路径或系统保留字符。");
      return name;
    }
    function rootPath(root) {
      if (typeof root !== "string" || !root) fail("请选择素材库目录。");
      return path.resolve(root);
    }
    function safe(root, relative) {
      root = rootPath(root);
      var result = path.resolve(root, relative);
      var rel = path.relative(root, result);
      if (!rel || rel === ".." || rel.indexOf(".." + path.sep) === 0 || path.isAbsolute(rel)) fail("拒绝访问素材库目录以外的路径。");
      // Reject directory links/junctions anywhere below the selected library.
      var parts = rel.split(path.sep), current = root;
      for (var i = 0; i < parts.length; i += 1) {
        current = path.join(current, parts[i]);
        if (exists(current) && fs.lstatSync(current).isSymbolicLink()) fail("素材库内不支持符号链接或目录联接。");
      }
      return result;
    }
    function raw(file) { return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""); }
    function json(file) {
      try { return JSON.parse(raw(file)); }
      catch (error) { fail("无法读取元数据 " + path.basename(file) + "：" + error.message); }
    }
    function readIndexes(root, tolerant) {
      var state = { root: rootPath(root), original: {}, warnings: [] };
      if (!exists(state.root) || !fs.statSync(state.root).isDirectory()) fail("素材库目录不存在。");
      indexNames.forEach(function (name, i) {
        var file = safe(state.root, name), value;
        state.original[name] = exists(file) ? raw(file) : null;
        try {
          if (state.original[name] === null) fail("缺少 " + name);
          value = JSON.parse(state.original[name]);
          if (!value || typeof value !== "object" || !Array.isArray(value[i === 2 ? "tags" : "datas"])) fail("格式不正确");
        } catch (error) {
          if (!tolerant) fail("素材库 " + name + " 无效：" + error.message + "。可使用修复数据重建索引。");
          value = i === 2 ? { tags: [], groups: [], version: "2.0.0" } : { datas: [], version: "2.0.0" };
          state.warnings.push(name + " 已从有效的 info.json 重建。");
        }
        state[name] = value;
      });
      hydrateTags(state);
      return state;
    }
    function hydrateTags(state) {
      // Some native versions keep membership only in Tag.json.file[]. Hydrate it
      // before editing, so an unrelated edit cannot erase those associations.
      var byId = Object.create(null);
      state["Files.json"].datas.forEach(function (item) { if (item && typeof item.id === "string" && !/^(?:__proto__|prototype|constructor)$/.test(item.id)) byId[item.id] = item; });
      state["Tag.json"].tags.forEach(function (tag) {
        if (!tag || typeof tag.name !== "string" || !Array.isArray(tag.file)) return;
        tag.file.forEach(function (id) {
          var item = byId[id]; if (!item) return;
          if (!Array.isArray(item.tags)) item.tags = [];
          if (item.tags.indexOf(tag.name) === -1) item.tags.push(tag.name);
        });
      });
    }
    function scan(root, section, warnings) {
      var dir = safe(root, section), records = [];
      if (!exists(dir)) return records;
      fs.readdirSync(dir).forEach(function (id) {
        try {
          validId(id);
          var folder = safe(root, path.join(section, id));
          if (!fs.statSync(folder).isDirectory()) return;
          var info = safe(root, path.join(section, id, "info.json"));
          if (!exists(info)) return;
          var item = json(info);
          if (!item || item.id !== id) fail("info.json 标识与目录不一致");
          validateRecord(item);
          records.push(item);
        } catch (error) { warnings.push(section + "/" + id + "：" + error.message); }
      });
      return records;
    }
    function validateRecord(item) {
      validId(item.id); validName(item.name);
      if (!supported.test(String(item.ext || ""))) fail("不支持的素材扩展名。");
      if (item.folder && !Array.isArray(item.folder)) fail("素材文件夹字段无效。");
      (item.folder || []).forEach(validId);
      if (item.tags && (!Array.isArray(item.tags) || item.tags.some(function (x) { return typeof x !== "string"; }))) fail("素材标签字段无效。");
    }
    function signature(state) { return indexNames.map(function (name) { return state.original[name]; }).join("\u0000"); }
    function load(root) {
      var state = readIndexes(root), warnings = state.warnings;
      var files = state["Files.json"].datas.filter(function (item) {
        try { validateRecord(item); return true; }
        catch (error) { warnings.push("已跳过无效素材记录：" + error.message); return false; }
      });
      var recycle = scan(state.root, "Recycle", warnings);
      snapshots[state.root] = signature(state);
      return { root: state.root, name: path.basename(state.root), files: clone(files), folders: clone(state["Folders.json"].datas), tags: clone(state["Tag.json"].tags), tagGroups: clone(Array.isArray(state["Tag.json"].groups) ? state["Tag.json"].groups : []), recycle: recycle, warnings: warnings };
    }
    function assetPaths(root, item, recycled) {
      validateRecord(item);
      var relative = path.join(recycled ? "Recycle" : "PSD", validId(item.id));
      var directory = safe(root, relative), names = exists(directory) ? fs.readdirSync(directory) : [];
      var source = safe(root, path.join(relative, validName(item.name) + "." + item.ext.toLowerCase()));
      if (!exists(source)) {
        var matching = names.filter(function (name) { return path.extname(name).slice(1).toLowerCase() === item.ext.toLowerCase(); });
        if (matching.length === 1) source = safe(root, path.join(relative, matching[0]));
      }
      var thumbnail = safe(root, path.join(relative, validName(item.name) + (item.ext.toLowerCase() === "png" ? ".preview.png" : ".png")));
      var preview = thumbnail;
      if (!exists(preview)) {
        var previews = names.filter(function (name) { return /\.(png|jpe?g|jfif|webp|gif|bmp)$/i.test(name) && path.join(directory, name) !== source; });
        if (previews.length) preview = safe(root, path.join(relative, previews[0]));
        else if (bitmap.test(item.ext) && exists(source)) preview = source;
      }
      return { source: source, preview: preview, thumbnail: thumbnail, directory: directory, sourceExists: exists(source), previewExists: exists(preview) };
    }
    function lock(root) {
      var file = safe(root, ".xinyang-library.lock"), fd;
      try { fd = fs.openSync(file, "wx"); fs.writeFileSync(fd, JSON.stringify({ time: new Date().toISOString() }), "utf8"); fs.closeSync(fd); }
      catch (error) { fail("素材库正在写入或上次写入未结束，请关闭其他素材库窗口后重试。" + (error.code === "EEXIST" ? "" : " " + error.message)); }
      return function () { if (exists(file)) fs.unlinkSync(file); };
    }
    function transact(root, change, tolerant) {
      root = rootPath(root);
      var release = lock(root), staged = [], replaced = [], moves = [], undoCopies = [], createdDirectories = [], backup = "", succeeded = false;
      try {
        var state = readIndexes(root, tolerant), initial = signature(state);
        if (!tolerant && snapshots[root] && snapshots[root] !== initial) fail("素材库已被其他程序修改，请刷新后重试。");
        var writes = {}, originals = {}, originalsRaw = {};
        function stage(relative, value) {
          var file = safe(root, relative);
          writes[file] = JSON.stringify(value, null, 2);
          if (!own(originals, file)) {
            originalsRaw[file] = exists(file) ? fs.readFileSync(file) : null;
            originals[file] = originalsRaw[file] === null ? null : originalsRaw[file].toString("utf8");
          }
        }
        var tx = {
          state: state,
          stage: stage,
          mkdir: function (directory) {
            if (path.resolve(directory) === root) return;
            safe(root, path.relative(root, directory));
            var missing = [], current = directory;
            while (current !== root && !exists(current)) { missing.push(current); current = path.dirname(current); }
            mkdir(directory);
            missing.reverse().forEach(function (entry) { createdDirectories.push(entry); });
          },
          move: function (from, to) {
            safe(root, path.relative(root, from)); safe(root, path.relative(root, to));
            if (from !== to && path.sep === "\\" && from.toLowerCase() === to.toLowerCase()) {
              var intermediate = from + ".rename-" + uid();
              fs.renameSync(from, intermediate); moves.push({ from: from, to: intermediate });
              fs.renameSync(intermediate, to); moves.push({ from: intermediate, to: to });
              return;
            }
            if (exists(to)) fail("目标位置已存在同名文件，已取消操作。");
            fs.renameSync(from, to); moves.push({ from: from, to: to });
          },
          copy: function (from, to) {
            safe(root, path.relative(root, to));
            if (exists(to)) fail("目标素材文件已存在。");
            fs.copyFileSync(from, to, fs.constants ? fs.constants.COPYFILE_EXCL : 1); undoCopies.push(to);
          },
          writeBinary: function (to, bytes) {
            safe(root, path.relative(root, to));
            fs.writeFileSync(to, bytes, { flag: "wx" }); undoCopies.push(to);
          }
        };
        change(tx);
        rebuildCounts(state);
        indexNames.forEach(function (name) { stage(name, state[name]); });
        if (signature(readIndexes(root, tolerant)) !== initial) fail("写入期间素材库被其他程序修改，已取消操作。");
        Object.keys(writes).forEach(function (file) {
          if ((exists(file) ? fs.readFileSync(file, "utf8") : null) !== originals[file]) fail("素材信息已被其他程序修改，已取消操作。");
        });
        backup = safe(root, path.join(".xinyang-backups", time() + "-" + uid()));
        mkdir(backup);
        Object.keys(writes).forEach(function (file) {
          var relative = path.relative(root, file);
          if (originalsRaw[file] !== null) {
            var saved = path.join(backup, relative); mkdir(path.dirname(saved)); fs.writeFileSync(saved, originalsRaw[file]);
          }
          tx.mkdir(path.dirname(file));
          var temp = file + ".xinyang-" + uid() + ".tmp";
          fs.writeFileSync(temp, writes[file], { encoding: "utf8", flag: "wx" });
          staged.push({ file: file, temp: temp });
        });
        // Each metadata file is atomically replaced; on error every replaced file is restored.
        staged.forEach(function (entry) { fs.renameSync(entry.temp, entry.file); replaced.push(entry.file); });
        fs.writeFileSync(path.join(backup, "transaction.json"), JSON.stringify({ completed: true, time: time(), files: Object.keys(writes).map(function (f) { return path.relative(root, f); }) }, null, 2), "utf8");
        succeeded = true;
      } catch (error) {
        var rollbackErrors = [];
        replaced.reverse().forEach(function (file) {
          try {
            if (originalsRaw[file] === null) fs.unlinkSync(file);
            else { var restore = file + ".restore-" + uid(); fs.writeFileSync(restore, originalsRaw[file]); fs.renameSync(restore, file); }
          } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
        });
        moves.reverse().forEach(function (move) { try { if (exists(move.to) && !exists(move.from)) fs.renameSync(move.to, move.from); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); } });
        undoCopies.reverse().forEach(function (file) { try { if (exists(file)) fs.unlinkSync(file); } catch (rollbackError) { rollbackErrors.push(rollbackError.message); } });
        if (rollbackErrors.length) error.message += "；回退不完整，请从备份恢复：" + backup + "；" + rollbackErrors.join("；");
        throw error;
      } finally {
        staged.forEach(function (entry) { if (exists(entry.temp)) { try { fs.unlinkSync(entry.temp); } catch (ignoreCleanupError) {} } });
        if (!succeeded) createdDirectories.reverse().forEach(function (directory) { try { if (exists(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory); } catch (ignoreDirectoryCleanupError) {} });
        release();
      }
      return load(root);
    }
    function rebuildCounts(state) {
      var files = state["Files.json"].datas;
      state["Folders.json"].datas.forEach(function (folder) { folder.number = files.filter(function (item) { return (item.folder || []).indexOf(folder.id) !== -1; }).length; });
      var tags = state["Tag.json"].tags;
      tags.forEach(function (tag) { tag.file = files.filter(function (item) { return (item.tags || []).indexOf(tag.name) !== -1; }).map(function (item) { return item.id; }); });
      files.forEach(function (item) {
        (item.tags || []).forEach(function (name) {
          if (!tags.some(function (tag) { return tag.name === name; })) tags.push({ id: uid(), name: name, file: files.filter(function (f) { return (f.tags || []).indexOf(name) !== -1; }).map(function (f) { return f.id; }), like: false });
        });
      });
    }
    function findAsset(state, id) {
      validId(id);
      var files = state["Files.json"].datas;
      for (var i = 0; i < files.length; i += 1) if (files[i].id === id) return files[i];
      fail("素材不存在，请刷新素材库。");
    }
    function folderIds(state, ids) {
      ids = ids || [];
      if (!Array.isArray(ids)) fail("文件夹列表无效。");
      return ids.filter(function (id, i) {
        validId(id);
        if (!state["Folders.json"].datas.some(function (folder) { return folder.id === id; })) fail("目标文件夹不存在。");
        return ids.indexOf(id) === i;
      });
    }
    function cleanTags(tags) {
      if (!Array.isArray(tags) || tags.length > 100) fail("标签列表无效。");
      return tags.map(function (tag) { tag = String(tag).replace(/^\s+|\s+$/g, ""); if (!tag || tag.length > 100) fail("标签名称不能为空或过长。"); return tag; }).filter(function (tag, i, all) { return all.indexOf(tag) === i; });
    }
    function stageInfo(tx, item, recycled) {
      var relative = path.join(recycled ? "Recycle" : "PSD", validId(item.id), "info.json");
      var file = safe(tx.state.root, relative), merged = {};
      if (exists(file)) { try { merged = json(file); } catch (ignoreDamagedInfo) {} }
      Object.keys(item).forEach(function (key) { Object.defineProperty(merged, key, { value: item[key], writable: true, enumerable: true, configurable: true }); });
      tx.stage(relative, merged);
    }
    function createLibrary(parent, name) {
      name = validName(name); if (!/\.Library$/i.test(name)) name += ".Library";
      var root = safe(rootPath(parent), name);
      if (exists(root)) fail("同名素材库已存在。");
      fs.mkdirSync(root); mkdir(safe(root, "PSD")); mkdir(safe(root, "Recycle"));
      fs.writeFileSync(safe(root, "Files.json"), JSON.stringify({ datas: [], version: "2.0.0" }), "utf8");
      fs.writeFileSync(safe(root, "Folders.json"), JSON.stringify({ datas: [], version: "2.0.0" }), "utf8");
      fs.writeFileSync(safe(root, "Tag.json"), JSON.stringify({ tags: [], groups: [], version: "2.0.0" }), "utf8");
      return load(root);
    }
    function createFolder(root, name, parentId) {
      name = validName(name);
      return transact(root, function (tx) {
        var folders = tx.state["Folders.json"].datas, pid = parentId || 0;
        if (pid) folderIds(tx.state, [pid]);
        if (folders.some(function (f) { return f.name.toLowerCase() === name.toLowerCase() && String(f.pid || 0) === String(pid); })) fail("同级文件夹已存在。");
        folders.push({ id: uid(), pid: pid, name: name, time: time(), tags: [], icon: "", iconColor: "", note: "", expanded: false, number: 0 });
      });
    }
    function updateAsset(root, id, patch) {
      patch = patch || {};
      return transact(root, function (tx) {
        var item = findAsset(tx.state, id);
        if (own(patch, "name") && validName(patch.name) !== item.name) {
          var oldPaths = assetPaths(root, item, false), next = clone(item); next.name = validName(patch.name);
          var rel = path.join("PSD", validId(id));
          var source = safe(root, path.join(rel, next.name + "." + next.ext));
          var preview = safe(root, path.join(rel, next.name + (oldPaths.preview === oldPaths.source ? "." + next.ext : next.ext.toLowerCase() === "png" ? ".preview.png" : path.extname(oldPaths.preview))));
          if (exists(oldPaths.source) && oldPaths.source !== source) tx.move(oldPaths.source, source);
          if (oldPaths.preview !== oldPaths.source && exists(oldPaths.preview) && oldPaths.preview !== preview) tx.move(oldPaths.preview, preview);
          item.name = next.name;
        }
        if (own(patch, "star")) { var star = Number(patch.star); if (star !== Math.floor(star) || star < 0 || star > 5) fail("星标必须为 0–5。"); item.star = star; }
        if (own(patch, "note")) item.note = String(patch.note).slice(0, 10000);
        if (own(patch, "folder")) item.folder = folderIds(tx.state, patch.folder);
        if (own(patch, "tags")) item.tags = cleanTags(patch.tags);
        ["width", "height"].forEach(function (key) { if (own(patch, key)) { var n = Number(patch[key]); if (!isFinite(n) || n < 0) fail("素材尺寸无效。"); item[key] = n; } });
        stageInfo(tx, item, false);
      });
    }
    function moveAsset(root, id, folderId, addOnly) {
      var state = readIndexes(root), item = findAsset(state, id), folders = addOnly ? (item.folder || []).slice() : [];
      if (folderId && folders.indexOf(folderId) === -1) folders.push(folderId);
      return updateAsset(root, id, { folder: folders });
    }
    function trashAsset(root, id) {
      return transact(root, function (tx) {
        var item = findAsset(tx.state, id);
        var from = safe(root, path.join("PSD", id)), to = safe(root, path.join("Recycle", id));
        mkdir(safe(root, "Recycle"));
        if (!exists(from)) fail("素材源目录不存在，已保留索引。");
        tx.move(from, to);
        tx.state["Files.json"].datas = tx.state["Files.json"].datas.filter(function (f) { return f.id !== id; });
        stageInfo(tx, item, true);
      });
    }
    function restoreAsset(root, id) {
      validId(id);
      return transact(root, function (tx) {
        if (tx.state["Files.json"].datas.some(function (f) { return f.id === id; })) fail("素材标识冲突，已保留回收站内容。");
        var from = safe(root, path.join("Recycle", id)), to = safe(root, path.join("PSD", id));
        var item = json(safe(root, path.join("Recycle", id, "info.json"))); validateRecord(item);
        if (item.id !== id) fail("回收站素材标识不一致。");
        mkdir(safe(root, "PSD")); tx.move(from, to);
        tx.state["Files.json"].datas.push(item); stageInfo(tx, item, false);
      });
    }
    function setTags(root, id, tags) { return updateAsset(root, id, { tags: tags }); }
    function updateTagGroups(state, id, name, newName) {
      var groups = state["Tag.json"].groups;
      if (!Array.isArray(groups)) return;
      groups.forEach(function (group) {
        if (!group || !Array.isArray(group.tags)) return;
        group.tags = group.tags.filter(function (entry) {
          var matches = typeof entry === "string" ? entry === name || (id && entry === id) : entry && ((id && entry.id === id) || entry.name === name);
          return newName !== null || !matches;
        }).map(function (entry) {
          if (newName === null) return entry;
          if (typeof entry === "string") return entry === name ? newName : entry;
          if (entry && ((id && entry.id === id) || entry.name === name) && own(entry, "name")) entry.name = newName;
          return entry;
        });
      });
    }
    function renameTag(root, name, newName) {
      newName = cleanTags([newName])[0];
      return transact(root, function (tx) {
        var tags = tx.state["Tag.json"].tags, source = null;
        tags.forEach(function (tag) { if (tag.name === name) source = tag; });
        if (!source) fail("标签不存在。");
        if (tags.some(function (tag) { return tag.name === newName && tag !== source; })) fail("同名标签已存在。");
        source.name = newName;
        updateTagGroups(tx.state, source.id, name, newName);
        tx.state["Files.json"].datas.forEach(function (item) {
          if ((item.tags || []).indexOf(name) === -1) return;
          item.tags = cleanTags(item.tags.map(function (tag) { return tag === name ? newName : tag; })); stageInfo(tx, item, false);
        });
        scan(root, "Recycle", []).forEach(function (item) { if ((item.tags || []).indexOf(name) !== -1) { item.tags = cleanTags(item.tags.map(function (tag) { return tag === name ? newName : tag; })); stageInfo(tx, item, true); } });
      });
    }
    function deleteTag(root, name) {
      return transact(root, function (tx) {
        tx.state["Tag.json"].tags.forEach(function (tag) { if (tag.name === name) updateTagGroups(tx.state, tag.id, name, null); });
        tx.state["Tag.json"].tags = tx.state["Tag.json"].tags.filter(function (tag) { return tag.name !== name; });
        function strip(item, recycled) { if ((item.tags || []).indexOf(name) === -1) return; item.tags = item.tags.filter(function (tag) { return tag !== name; }); stageInfo(tx, item, recycled); }
        tx.state["Files.json"].datas.forEach(function (item) { strip(item, false); });
        scan(root, "Recycle", []).forEach(function (item) { strip(item, true); });
      });
    }
    function newRecord(root, name, folderId, ext) {
      var id;
      do { id = uid(); } while (exists(safe(root, path.join("PSD", id))) || exists(safe(root, path.join("Recycle", id))));
      return { id: id, name: validName(name), ext: ext || "psd", width: 0, height: 0, size: "0", star: 0, find: [], time: time(), tags: [], folder: folderId ? [folderId] : [], note: "", Y: 0 };
    }
    function availableFolderName(folders, original, parentId) {
      var name = original, suffix = 1;
      while (folders.some(function (folder) { return String(folder.pid || 0) === String(parentId || 0) && folder.name.toLowerCase() === name.toLowerCase(); })) {
        suffix += 1; var tail = " (" + suffix + ")"; name = original.slice(0, 180 - tail.length) + tail;
      }
      return name;
    }
    function reserveAsset(root, name, folderId) {
      var state = readIndexes(root); folderIds(state, folderId ? [folderId] : []);
      var release = lock(root);
      try {
        var item = newRecord(root, name, folderId, "psd"), paths = assetPaths(root, item, false);
        mkdir(paths.directory);
        fs.writeFileSync(path.join(paths.directory, ".xinyang-reservation.json"), JSON.stringify(item), { encoding: "utf8", flag: "wx" });
        item.source = paths.source; item.preview = paths.preview; item.directory = paths.directory;
        return item;
      } finally { release(); }
    }
    function commitAsset(root, record) {
      var item = clone(record); delete item.source; delete item.preview; delete item.directory;
      validateRecord(item);
      var data = transact(root, function (tx) {
        if (tx.state["Files.json"].datas.some(function (f) { return f.id === item.id; })) fail("该素材已提交。");
        folderIds(tx.state, item.folder);
        var paths = assetPaths(root, item, false);
        if (!exists(paths.source) || fs.statSync(paths.source).size === 0) fail("导出的素材源文件不存在或为空，未添加索引。");
        item.size = (fs.statSync(paths.source).size / 1024).toFixed(2);
        tx.state["Files.json"].datas.push(item); stageInfo(tx, item, false);
      });
      var marker = safe(root, path.join("PSD", item.id, ".xinyang-reservation.json"));
      try { if (exists(marker)) fs.unlinkSync(marker); }
      catch (cleanupError) { data.warnings.push("素材已保存；预留标记未能清理：" + cleanupError.message); }
      return data;
    }
    function cancelReservation(root, record) {
      validId(record.id);
      var directory = safe(root, path.join("PSD", record.id)), marker = safe(root, path.join("PSD", record.id, ".xinyang-reservation.json"));
      if (!exists(marker)) return { removed: false, preserved: false };
      var reservation = json(marker);
      if (reservation.id !== record.id || reservation.name !== record.name) fail("预留素材信息不一致，已保留文件。");
      var entries = fs.readdirSync(directory);
      if (entries.length !== 1 || entries[0] !== ".xinyang-reservation.json") return { removed: false, preserved: true };
      fs.unlinkSync(marker);
      try { fs.rmdirSync(directory); }
      catch (error) { return { removed: false, preserved: true }; }
      return { removed: true, preserved: false };
    }
    function importFiles(root, paths, folderId) {
      if (!Array.isArray(paths)) paths = [paths];
      var sources = [], seen = {}, directories = [], directoryByPath = {}, visited = 0;
      function collect(file, depth, parent) {
        if (depth > 32) fail("导入文件夹层级过深。");
        visited += 1; if (visited > 20000) fail("导入目录包含过多文件，请选择较小的文件夹。");
        file = path.resolve(file);
        var stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) return;
        if (stat.isDirectory()) {
          var key = path.sep === "\\" ? file.toLowerCase() : file;
          var directory = directoryByPath[key];
          if (!directory) {
            directory = { name: validName(path.basename(file)), parent: parent, id: null };
            directoryByPath[key] = directory; directories.push(directory);
          } else return;
          fs.readdirSync(file).forEach(function (name) { collect(path.join(file, name), depth + 1, directory); });
          return;
        }
        var fileKey = path.sep === "\\" ? file.toLowerCase() : file;
        if (!stat.isFile() || !supported.test(path.extname(file).slice(1)) || seen[fileKey]) return;
        seen[fileKey] = true; sources.push({ path: file, parent: parent }); if (sources.length > 5000) fail("单次最多导入 5000 个素材。");
      }
      // Ancestors are collected first so overlapping selections preserve one tree.
      paths.map(function (file) { return path.resolve(file); }).sort(function (left, right) { return left.length - right.length; }).forEach(function (file) { collect(file, 0, null); });
      if (!sources.length) fail("没有可导入的 PSD、PSB 或图片文件。");
      return transact(root, function (tx) {
        folderIds(tx.state, folderId ? [folderId] : []);
        var folders = tx.state["Folders.json"].datas;
        directories.forEach(function (directory) {
          var parentId = directory.parent ? directory.parent.id : (folderId || 0);
          var name = availableFolderName(folders, directory.name, parentId);
          directory.id = uid();
          folders.push({ id: directory.id, pid: parentId, name: name, time: time(), tags: [], icon: "", iconColor: "", note: "", expanded: false, number: 0 });
        });
        sources.forEach(function (entry) {
          var source = entry.path;
          var ext = path.extname(source).slice(1).toLowerCase(), item = newRecord(root, path.basename(source, path.extname(source)), entry.parent ? entry.parent.id : folderId, ext);
          var target = assetPaths(root, item, false); tx.mkdir(target.directory); tx.copy(source, target.source);
          if (!bitmap.test(ext)) {
            var sibling = source.slice(0, -path.extname(source).length) + ".png";
            if (exists(sibling) && !fs.lstatSync(sibling).isSymbolicLink()) tx.copy(sibling, target.preview);
          }
          item.size = (fs.statSync(source).size / 1024).toFixed(2);
          var dimensions = imageDimensions(source, ext); item.width = dimensions.width; item.height = dimensions.height;
          tx.state["Files.json"].datas.push(item); stageInfo(tx, item, false);
        });
      });
    }
    function imageDimensions(source, ext) {
      var fd, bytes, length, result = { width: 0, height: 0 };
      try {
        fd = fs.openSync(source, "r"); bytes = BufferType.alloc(65536); length = fs.readSync(fd, bytes, 0, bytes.length, 0);
        if (/^(psd|psb)$/i.test(ext) && length >= 26 && bytes.toString("ascii", 0, 4) === "8BPS") { result.height = bytes.readUInt32BE(14); result.width = bytes.readUInt32BE(18); }
        else if (ext === "png" && length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") { result.width = bytes.readUInt32BE(16); result.height = bytes.readUInt32BE(20); }
        else if (ext === "gif" && length >= 10 && bytes.toString("ascii", 0, 3) === "GIF") { result.width = bytes.readUInt16LE(6); result.height = bytes.readUInt16LE(8); }
        else if (ext === "bmp" && length >= 26 && bytes.toString("ascii", 0, 2) === "BM") { result.width = bytes.readUInt32LE(18); result.height = Math.abs(bytes.readInt32LE(22)); }
        else if (/^(jpe?g|jfif)$/i.test(ext) && length > 4 && bytes[0] === 255 && bytes[1] === 216) {
          var offset = 2;
          while (offset + 8 < length) {
            if (bytes[offset] !== 255) break;
            var marker = bytes[offset + 1], size = bytes.readUInt16BE(offset + 2);
            if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].indexOf(marker) !== -1) { result.height = bytes.readUInt16BE(offset + 5); result.width = bytes.readUInt16BE(offset + 7); break; }
            if (size < 2) break; offset += size + 2;
          }
        }
        else if (ext === "webp" && length >= 25 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
          var chunk = bytes.toString("ascii", 12, 16);
          if (chunk === "VP8X" && length >= 30) { result.width = bytes.readUIntLE(24, 3) + 1; result.height = bytes.readUIntLE(27, 3) + 1; }
          else if (chunk === "VP8L" && bytes[20] === 47) { var packed = bytes.readUInt32LE(21); result.width = (packed & 16383) + 1; result.height = ((packed >>> 14) & 16383) + 1; }
          else if (chunk === "VP8 " && length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { result.width = bytes.readUInt16LE(26) & 16383; result.height = bytes.readUInt16LE(28) & 16383; }
        }
        else if (/^tiff?$/i.test(ext) && length >= 8) {
          var order = bytes.toString("ascii", 0, 2), little = order === "II";
          if (little || order === "MM") {
            function u16(buffer, offset) { return little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset); }
            function u32(buffer, offset) { return little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset); }
            function u64(buffer, offset) { var low = u32(buffer, offset + (little ? 0 : 4)), high = u32(buffer, offset + (little ? 4 : 0)); var value = high * 4294967296 + low; if (value > 9007199254740991) throw new Error("TIFF offset is too large"); return value; }
            function block(offset, size) { var buffer = BufferType.alloc(size); if (fs.readSync(fd, buffer, 0, size, offset) !== size) throw new Error("Incomplete TIFF header"); return buffer; }
            var magic = u16(bytes, 2), big = magic === 43;
            if (magic === 42 || (big && length >= 16 && u16(bytes, 4) === 8)) {
              var ifd = big ? u64(bytes, 8) : u32(bytes, 4), countBytes = big ? 8 : 2;
              var countBuffer = block(ifd, countBytes), count = big ? u64(countBuffer, 0) : u16(countBuffer, 0);
              if (count > 4096) throw new Error("TIFF IFD contains too many entries");
              var entrySize = big ? 20 : 12, entries = block(ifd + countBytes, count * entrySize);
              for (var entryIndex = 0; entryIndex < count; entryIndex += 1) {
                var entryOffset = entryIndex * entrySize, tag = u16(entries, entryOffset), type = u16(entries, entryOffset + 2);
                if (tag !== 256 && tag !== 257) continue;
                var elementCount = big ? u64(entries, entryOffset + 4) : u32(entries, entryOffset + 4);
                if (elementCount !== 1) continue;
                var valueOffset = entryOffset + (big ? 12 : 8), dimension = type === 3 ? u16(entries, valueOffset) : type === 4 ? u32(entries, valueOffset) : big && type === 16 ? u64(entries, valueOffset) : 0;
                if (tag === 256) result.width = dimension; else result.height = dimension;
              }
            }
          }
        }
      } catch (ignoreDimensionError) {}
      finally { if (fd !== undefined) fs.closeSync(fd); }
      return result;
    }
    function importJsonPack(root, file, folderId) {
      if (fs.statSync(file).size > 360 * 1024 * 1024) fail("素材包过大，单包上限为 360 MB。");
      var pack = json(file), total = 0;
      if (!pack || pack.magic !== "XinyangLibraryPack" || pack.version !== 1 || !Array.isArray(pack.assets) || !pack.assets.length || pack.assets.length > 5000) fail("不支持此素材包。仅支持本插件导出的 Xinyang .pack v1，原文件未更改。");
      // Validate the complete package before acquiring the write lock or writing any files.
      pack.assets.forEach(function (asset) {
        if (!asset || !asset.record || !Array.isArray(asset.files) || !asset.files.length || asset.files.length > 2) fail("素材包结构无效。");
        validateRecord(asset.record);
        var names = {}, sourceFound = false;
        asset.files.forEach(function (entry) {
          var name = validName(entry.name);
          if (names[name.toLowerCase()]) fail("素材包包含重复文件名。"); names[name.toLowerCase()] = true;
          if (!supported.test(path.extname(name).slice(1))) fail("素材包包含不支持的文件类型。");
          if (path.extname(name).slice(1).toLowerCase() === asset.record.ext.toLowerCase()) sourceFound = true;
          if (typeof entry.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) fail("素材包文件编码无效。");
          total += entry.data.length * 0.75; if (total > 256 * 1024 * 1024) fail("素材包解码大小超过 256 MB。");
        });
        if (!sourceFound) fail("素材包缺少源文件。");
      });
      return transact(root, function (tx) {
        folderIds(tx.state, folderId ? [folderId] : []);
        pack.assets.forEach(function (asset) {
          var item = clone(asset.record), fresh = newRecord(root, item.name, folderId, item.ext);
          item.id = fresh.id; item.folder = fresh.folder; item.tags = cleanTags(item.tags || []);
          var directory = safe(root, path.join("PSD", item.id)); tx.mkdir(directory);
          asset.files.forEach(function (entry) { tx.writeBinary(safe(root, path.join("PSD", item.id, validName(entry.name))), BufferType.from(entry.data, "base64")); });
          tx.state["Files.json"].datas.push(item); stageInfo(tx, item, false);
        });
      });
    }
    // Native .pack files are directories: folder.json and PSD/<id>/info.json + artwork.
    function exportPack(root, ids, destination) {
      if (!Array.isArray(ids) || !ids.length) fail("请选择要分享的素材。");
      destination = path.resolve(destination); if (!/\.pack$/i.test(destination)) destination += ".pack";
      if (exists(destination)) fail("目标素材包已存在，请使用其他名称。");
      var state = readIndexes(root), records = [], sourceFiles = [];
      ids.forEach(function (id, i) {
        if (ids.indexOf(id) !== i) return;
        var item = clone(findAsset(state, id)), paths = assetPaths(root, item, false);
        if (!exists(paths.source)) fail("素材源文件不存在，无法分享。");
        var infoFile = safe(root, path.join("PSD", item.id, "info.json"));
        if (exists(infoFile)) {
          try {
            var infoRecord = json(infoFile);
            if (infoRecord && infoRecord.id === item.id) Object.keys(infoRecord).forEach(function (key) { if (!own(item, key)) Object.defineProperty(item, key, { value: infoRecord[key], writable: true, enumerable: true, configurable: true }); });
          } catch (ignoreDamagedPackInfo) {}
        }
        records.push(item); sourceFiles.push(paths);
      });
      var folders = state["Folders.json"].datas, required = {};
      records.forEach(function (item) { (item.folder || []).forEach(function (id) { required[id] = true; }); });
      var changed = true;
      while (changed) {
        changed = false;
        folders.forEach(function (folder) { if (required[folder.id] && folder.pid && !required[folder.pid]) { required[folder.pid] = true; changed = true; } });
      }
      var roots = folders.filter(function (folder) { return required[folder.id] && !required[folder.pid]; });
      var packFolder;
      function tree(folder, seen) {
        if (seen[folder.id]) fail("素材库文件夹存在循环引用。");
        seen = clone(seen); seen[folder.id] = true;
        var result = clone(folder); delete result.pid;
        result.number = records.filter(function (item) { return (item.folder || []).indexOf(folder.id) !== -1; }).length;
        result.childrens = folders.filter(function (child) { return required[child.id] && child.pid === folder.id; }).map(function (child) { return tree(child, seen); });
        return result;
      }
      if (roots.length === 1) packFolder = tree(roots[0], {});
      else packFolder = { id: uid(), name: path.basename(destination).replace(/\.pack$/i, ""), time: time(), tags: [], icon: "", iconColor: "", note: "", expanded: false, number: records.length, childrens: roots.map(function (folder) { return tree(folder, {}); }) };
      packFolder.number = records.filter(function (item) { return !(item.folder || []).length || (item.folder || []).indexOf(packFolder.id) !== -1; }).length;
      var staging = destination + ".xinyang-" + uid(), written = [];
      fs.mkdirSync(staging);
      try {
        mkdir(path.join(staging, "PSD"));
        records.forEach(function (item, i) {
          item.folder = (item.folder || []).filter(function (id) { return !!required[id]; });
          if (!item.folder.length) item.folder = [packFolder.id];
          var directory = path.join(staging, "PSD", validId(item.id)); mkdir(directory);
          var paths = sourceFiles[i], target = path.join(directory, path.basename(paths.source));
          fs.copyFileSync(paths.source, target, fs.constants ? fs.constants.COPYFILE_EXCL : 1); written.push(target);
          if (exists(paths.preview) && paths.preview !== paths.source) { target = path.join(directory, path.basename(paths.preview)); fs.copyFileSync(paths.preview, target, fs.constants ? fs.constants.COPYFILE_EXCL : 1); written.push(target); }
          target = path.join(directory, "info.json"); fs.writeFileSync(target, JSON.stringify(item), "utf8"); written.push(target);
        });
        var folderFile = path.join(staging, "folder.json"); fs.writeFileSync(folderFile, JSON.stringify(packFolder), "utf8"); written.push(folderFile);
        if (exists(destination)) fail("目标素材包已被其他程序创建，已取消导出。");
        fs.renameSync(staging, destination);
      } catch (error) {
        // Only remove files created by this invocation; never touch an existing pack.
        written.reverse().forEach(function (file) { try { if (exists(file)) fs.unlinkSync(file); } catch (ignoreCleanupError) {} });
        records.forEach(function (item) { try { fs.rmdirSync(path.join(staging, "PSD", item.id)); } catch (ignoreCleanupError) {} });
        try { fs.rmdirSync(path.join(staging, "PSD")); fs.rmdirSync(staging); } catch (ignoreCleanupError) {}
        throw error;
      }
      return { path: destination, count: records.length, format: "NativeLibraryPack", version: "2.0.0" };
    }
    function importPack(root, file, folderId) {
      if (!fs.statSync(file).isDirectory()) return importJsonPack(root, file, folderId);
      file = rootPath(file);
      if (fs.lstatSync(file).isSymbolicLink()) fail("素材包不支持符号链接。");
      var folderFile = safe(file, "folder.json"), sourceRoot = safe(file, "PSD");
      if (!exists(folderFile) || !exists(sourceRoot)) fail("素材包缺少 folder.json 或 PSD 目录。");
      var folder = json(folderFile), folderRecords = [], folderLookup = {}, sourceRecords = [], total = 0;
      function visit(entry, parent, depth) {
        if (!entry || depth > 32) fail("素材包文件夹层级无效。");
        validId(entry.id); validName(entry.name);
        if (folderLookup[entry.id]) fail("素材包包含重复文件夹标识。");
        if (entry.childrens && !Array.isArray(entry.childrens)) fail("素材包文件夹结构无效。");
        folderLookup[entry.id] = true; folderRecords.push({ item: entry, parent: parent });
        (entry.childrens || []).forEach(function (child) { visit(child, entry.id, depth + 1); });
      }
      visit(folder, null, 0);
      var entries = fs.readdirSync(sourceRoot);
      if (entries.length > 5000) fail("单次最多导入 5000 个素材。");
      entries.forEach(function (id) {
        validId(id);
        var directory = safe(file, path.join("PSD", id));
        if (!fs.statSync(directory).isDirectory()) fail("素材包 PSD 目录包含未知文件。");
        var item = json(safe(file, path.join("PSD", id, "info.json"))); validateRecord(item);
        if (item.id !== id) fail("素材包素材标识与目录不一致。");
        var paths = assetPaths(file, item, false);
        if (!exists(paths.source) || !fs.statSync(paths.source).isFile()) fail("素材包缺少源文件。");
        total += fs.statSync(paths.source).size;
        if (exists(paths.preview) && paths.preview !== paths.source) total += fs.statSync(paths.preview).size;
        if (total > 20 * 1024 * 1024 * 1024) fail("单次素材包导入上限为 20 GB。");
        sourceRecords.push({ item: item, paths: paths });
      });
      if (!sourceRecords.length) fail("素材包内没有素材。");
      return transact(root, function (tx) {
        folderIds(tx.state, folderId ? [folderId] : []);
        var mapping = {};
        folderRecords.forEach(function (entry) { mapping[entry.item.id] = uid(); });
        folderRecords.forEach(function (entry) {
          var item = clone(entry.item); delete item.childrens;
          item.id = mapping[entry.item.id]; item.pid = entry.parent ? mapping[entry.parent] : (folderId || 0);
          item.name = availableFolderName(tx.state["Folders.json"].datas, item.name, item.pid);
          tx.state["Folders.json"].datas.push(item);
        });
        sourceRecords.forEach(function (source) {
          var item = clone(source.item), fresh = newRecord(root, item.name, null, item.ext);
          item.id = fresh.id; item.folder = (item.folder || []).map(function (id) { return mapping[id]; }).filter(function (id) { return !!id; });
          if (!item.folder.length) item.folder = [mapping[folder.id]];
          var directory = safe(root, path.join("PSD", item.id)); tx.mkdir(directory);
          tx.copy(source.paths.source, safe(root, path.join("PSD", item.id, path.basename(source.paths.source))));
          if (exists(source.paths.preview) && source.paths.preview !== source.paths.source) tx.copy(source.paths.preview, safe(root, path.join("PSD", item.id, path.basename(source.paths.preview))));
          tx.state["Files.json"].datas.push(item); stageInfo(tx, item, false);
        });
      });
    }
    function repair(root) {
      var warnings = [];
      var data = transact(root, function (tx) {
        warnings = warnings.concat(tx.state.warnings);
        var folders = [], folderMap = {}, tags = [], tagNames = {};
        tx.state["Folders.json"].datas.forEach(function (folder) {
          try {
            if (!folder || typeof folder !== "object") fail("文件夹记录为空");
            validId(folder.id); validName(folder.name);
            if (folderMap[folder.id]) fail("重复文件夹标识");
            folderMap[folder.id] = folder; folders.push(folder);
          } catch (error) { warnings.push("文件夹记录未恢复：" + error.message); }
        });
        folders.forEach(function (folder) {
          if (!folder.pid || !own(folderMap, folder.pid)) { folder.pid = 0; return; }
          var chain = {}, cursor = folder;
          while (cursor) {
            if (chain[cursor.id]) { folder.pid = 0; warnings.push("已断开循环分类：" + folder.name); break; }
            chain[cursor.id] = true; cursor = cursor.pid ? folderMap[cursor.pid] : null;
          }
        });
        tx.state["Folders.json"].datas = folders;
        tx.state["Tag.json"].tags.forEach(function (tag) {
          try {
            if (!tag || typeof tag !== "object" || typeof tag.name !== "string" || !tag.name.trim()) fail("标签名称无效");
            var key = "name_" + tag.name;
            if (tagNames[key]) {
              var existing = tagNames[key];
              (Array.isArray(tag.file) ? tag.file : []).forEach(function (id) { if (existing.file.indexOf(id) === -1) existing.file.push(id); });
              warnings.push("已合并重复标签：" + tag.name); return;
            }
            try { validId(tag.id); } catch (ignoreTagId) { tag.id = uid(); }
            if (!Array.isArray(tag.file)) tag.file = [];
            tagNames[key] = tag; tags.push(tag);
          } catch (error) { warnings.push("标签记录未恢复：" + error.message); }
        });
        tx.state["Tag.json"].tags = tags;
        var recovered = scan(root, "PSD", warnings), old = tx.state["Files.json"].datas, known = {}, recycled = {};
        scan(root, "Recycle", warnings).forEach(function (item) { recycled[item.id] = true; });
        recovered.forEach(function (item) { known[item.id] = true; });
        // Keep valid indexed records whose info file is absent; never silently drop a source.
        old.forEach(function (item) {
          try {
            validateRecord(item);
            if (known[item.id]) return;
            if (recycled[item.id] && !exists(safe(root, path.join("PSD", item.id)))) { warnings.push("已移除回收站素材的过期活动索引：" + item.name); return; }
            recovered.push(item); known[item.id] = true; stageInfo(tx, item, false);
          } catch (error) { warnings.push("索引记录未恢复：" + error.message); }
        });
        recovered.forEach(function (item) { (item.folder || []).forEach(function (id) { if (!folders.some(function (folder) { return folder.id === id; })) folders.push({ id: id, pid: 0, name: "恢复文件夹 " + id.slice(0, 8), time: time(), tags: [], number: 0 }); }); });
        tx.state["Files.json"].datas = recovered;
        hydrateTags(tx.state);
      }, true);
      data.warnings = data.warnings.concat(warnings); return data;
    }
    return { load: load, createLibrary: createLibrary, assetPaths: assetPaths, updateAsset: updateAsset, createFolder: createFolder, moveAsset: moveAsset, trashAsset: trashAsset, restoreAsset: restoreAsset, setTags: setTags, renameTag: renameTag, deleteTag: deleteTag, importFiles: importFiles, reserveAsset: reserveAsset, commitAsset: commitAsset, cancelReservation: cancelReservation, exportPack: exportPack, importPack: importPack, repair: repair };
  }
  var api = { create: create };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global) global.XinyangLibraryStore = api;
}(typeof window !== "undefined" ? window : this));
