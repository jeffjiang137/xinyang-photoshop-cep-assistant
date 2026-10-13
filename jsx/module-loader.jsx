/* 鑫洋助理 ExtendScript 模块加载器：支持启动核心模块 + 业务域按需加载（v2.2.58） */
/*
 * host.jsx 每次重载都会重新创建 XinyangHostModules。加载器不能沿用上一次
 * host.jsx 的 loadedMap，否则会误以为核心 JSX 已经在当前宿主模块表中注册，
 * 从而跳过 $.evalFile，最终导致 coreShared/coreLayers 未定义并让整个宿主
 * 脚本以 CEP error code 38 失败。这里每次 evalFile 都创建新的加载器代际；
 * 同一代内仍然保持单路径缓存，业务模块不会重复加载。
 */
var XinyangHostModuleLoader = (function () {
        var loaded = [];
        var loadedMap = {};
        var failed = [];

        function normalize(path) {
            return String(path || "").replace(/\\/g, "/");
        }

        function loadOne(hostFile, relativePath) {
            var base = hostFile && hostFile.parent ? hostFile.parent : File(hostFile).parent;
            var relative = String(relativePath || "");
            var globalObject = $.global;
            var moduleTable = globalObject.XinyangHostModules;
            if (!relative) throw new Error("宿主模块路径为空");
            if (loadedMap[relative]) return true;

            if (!moduleTable) {
                moduleTable = {};
                globalObject.XinyangHostModules = moduleTable;
            }
            /*
             * 每个模块会显式从 $.global 取得 XinyangHostModules。不能只
             * 在这里设置同名局部变量：$.evalFile 可能把模块的 var 声明
             * 绑定到它自己的临时作用域，造成模块工厂注册后立即丢失。
             */

            var file = File(normalize(base.fsName) + "/" + relative);
            if (!file.exists) {
                failed.push(relative + "：文件不存在");
                throw new Error("宿主模块缺失：" + relative);
            }
            try {
                $.evalFile(file);
                loadedMap[relative] = true;
                loaded.push(relative);
                return true;
            } catch (error) {
                /*
                 * Photoshop 27.x on some Windows locale/encoding combinations
                 * can throw Error 44 ("Cannot convert") from $.evalFile before
                 * the JSX source is evaluated. Read the file as UTF-8 and use
                 * ExtendScript's evaluator as a compatibility fallback. Every
                 * module registers its factory on $.global, so evaluating the
                 * source in this loader scope does not leak private variables.
                */
                var firstMessage = String(error && error.message ? error.message : error);
                var errorNumber = Number(error && (error.number !== undefined ? error.number : error.code));
                var canUseCompatibilityFallback = /convert|转换/i.test(firstMessage) || errorNumber === 44 || errorNumber === -44;
                if (!canUseCompatibilityFallback) {
                    failed.push(relative + "：" + firstMessage);
                    throw error;
                }
                var fallbackError = null;
                var source = null;
                try {
                    file.encoding = "UTF-8";
                    if (!file.open("r")) throw new Error("文件无法打开：" + file.fsName);
                    source = file.read();
                    file.close();
                    if (!source) throw new Error("文件内容为空：" + file.fsName);
                    eval(source);
                    loadedMap[relative] = true;
                    loaded.push(relative);
                    return true;
                } catch (compatibilityError) {
                    fallbackError = compatibilityError;
                    try { if (file.opened) file.close(); } catch (ignoreClose) {}
                }
                var fallbackMessage = String(fallbackError && fallbackError.message ? fallbackError.message : fallbackError);
                failed.push(relative + "：" + firstMessage + "；UTF-8 回退：" + fallbackMessage);
                throw new Error("宿主模块加载失败：" + relative + "（" + firstMessage + "；UTF-8 回退：" + fallbackMessage + "）");
            }
        }

        function load(hostFile, paths) {
            var index;
            paths = paths || [];
            for (index = 0; index < paths.length; index += 1) {
                loadOne(hostFile, paths[index]);
            }
            return true;
        }

        function isLoaded(relativePath) {
            return !!loadedMap[String(relativePath || "")];
        }

        function diagnostics() {
            return {
                loaded: loaded.slice(0),
                failed: failed.slice(0)
            };
        }

        return {
            load: load,
            loadOne: loadOne,
            isLoaded: isLoaded,
            diagnostics: diagnostics
        };
}());

/* host.jsx 的按需业务加载位于另一层 IIFE，显式发布加载器代际。 */
$.global.XinyangHostModuleLoader = XinyangHostModuleLoader;
