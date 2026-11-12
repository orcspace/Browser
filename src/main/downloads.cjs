const { randomUUID } = require("node:crypto");
const { EventEmitter } = require("node:events");
class Downloads extends EventEmitter {
  constructor(session) {
    super();
    this.items = [];
    this.session = session;
    this.listener = (_event, item, contents) => {
      item.setSaveDialogOptions({
        title: "Save download",
        buttonLabel: "Save",
      });
      const entry = {
        id: randomUUID(),
        name: item.getFilename(),
        received: 0,
        total: item.getTotalBytes(),
        state: "progressing",
        path: "",
      };
      this.items.unshift(entry);
      // Keep all running downloads, cap completed history only.
      this.items = this.items.filter(
        (item, index) => index < 100 || item.state === "progressing",
      );
      this.emit("change");
      this.emit("started", contents);
      item.on("updated", (_e, state) => {
        entry.received = item.getReceivedBytes();
        entry.total = item.getTotalBytes();
        entry.state = state;
        this.emit("change");
      });
      item.once("done", (_e, state) => {
        entry.state = state;
        entry.path = item.getSavePath();
        this.emit("change");
        this.emit("finished", contents);
      });
    };
    session.on("will-download", this.listener);
  }
  dispose() {
    this.session.removeListener("will-download", this.listener);
    this.removeAllListeners();
  }
}
module.exports = { Downloads };
