#target photoshop
#targetengine "xinyangAutoEmbed"
(function () {
    try {
        var hostFile = new File(File($.fileName).parent.parent.fsName + "/host.jsx");
        if (typeof LongStitchCEP === "undefined" && hostFile.exists) {
            $.evalFile(hostFile);
        }
        if (typeof LongStitchCEP !== "undefined") {
            LongStitchCEP.invoke("toolsAutoEmbedActiveLayer", "{\"trigger\":\"paste\"}");
        }
    } catch (ignoreAutoEmbedNotifier) {}
}());
