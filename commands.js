        },
    },
    {
        name: "developer",
        aliases: ["dev", "bug", "report", "support"],
        description: "Developer contact",
        async execute(sock, { from, msg }) {
            await sock.sendMessage(from, { text: `👨‍💻 *Tasmee ul Hasnain*\n📞 wa.me/923423899407` }, { quoted: msg });
        },
    }
];

module.exports = allCommands;
module.exports.pendingYt = new Map();
module.exports.pendingYtChoice = new Map();
module.exports.pendingPdfChoice = new Map();
module.exports.fetchArchivePdf = fetchArchivePdf;
module.exports.pendingImage = new Map();
module.exports.downloadYt = downloadYt;
module.exports.isOwner = isOwner;
module.exports.synthesizeSpeech = synthesizeSpeech;
module.exports.startYtFlow = startYtFlow;
module.exports.generateAndSendImage = generateAndSendImage;
module.exports.fetchOrGenerateImage = fetchOrGenerateImage;
module.exports.webSearch = webSearch;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.getPakistanDateTimeString = getPakistanDateTimeString;
module.exports.chatWithTools = chatWithTools;
module.exports.AI_TOOLS = AI_TOOLS;
module.exports.runAiTool = runAiTool;
module.exports.MENU_CATEGORIES = MENU_CATEGORIES;
