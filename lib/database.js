const fs = require("fs");
const path = require("path");

const DB_DIR = path.join(__dirname, "..", "data");

function ensure(name, def) {
    const file = path.join(DB_DIR, name);

    if (!fs.existsSync(DB_DIR))
        fs.mkdirSync(DB_DIR, { recursive: true });

    if (!fs.existsSync(file))
        fs.writeFileSync(file, JSON.stringify(def, null, 2));

    return file;
}

const files = {
    banned: ensure("banned.json", []),
    sudo: ensure("sudo.json", []),
    antilink: ensure("antilink.json", {})
};

function read(file) {
    return JSON.parse(fs.readFileSync(file));
}

function write(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = {
    files,
    read,
    write
};
