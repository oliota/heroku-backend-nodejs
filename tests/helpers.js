import { AdedonhaService } from "../adedonha/service.js";

// Test-only serializable transaction model: failed callbacks discard every write.
export class MemoryRepository {
  constructor() {
    this.data = new Map();
    this.tail = Promise.resolve();
  }
  transaction(callback) {
    const task = this.tail.then(async () => {
      const data = structuredClone(this.data);
      const result = await callback({
        get: async (path) => structuredClone(data.get(path) ?? null),
        set: (path, value) => data.set(path, structuredClone(value)),
        delete: (path) => data.delete(path),
        list: async (path, filters = [], limit = 50, after = "") =>
          [...data]
            .filter(
              ([key, value]) =>
                key.startsWith(`${path}/`) &&
                key.split("/").length === path.split("/").length + 1 &&
                key.split("/").at(-1) > after &&
                filters.every(
                  ([field, op, expected]) =>
                    op === "==" && value[field] === expected,
                ),
            )
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, limit)
            .map(([key, value]) => ({ ...value, id: key.split("/").at(-1) })),
      });
      this.data = data;
      return result;
    });
    this.tail = task.catch(() => {});
    return task;
  }
}
export function harness(options = {}) {
  const repo = new MemoryRepository();
  const service = new AdedonhaService(repo, options);
  let n = 0;
  const call = (action, uid = "u1", input = {}, context = {}) =>
    service.execute(action, { uid, name: uid }, input, {
      key: `operation_${++n}`,
      ...context,
    });
  const sync = (uid) => call("me:sync", uid, { name: uid });
  const roomCall = (room, action, uid = "u1", input = {}, context = {}) =>
    call(
      action,
      uid,
      {
        version: room.version,
        game_id: room.game_id,
        round_id: room.round_id,
        ...input,
      },
      { code: room.code, ...context },
    );
  const setup = async (players = ["u1", "u2"], settings = {}) => {
    for (const id of players) await sync(id);
    let room = await call("rooms:create", players[0], {
      settings: {
        lang: "pt",
        categories: ["COR", "CARRO", "FRUTA"],
        letters: "ABC",
        rounds: 1,
        timer: 0,
        ...settings,
      },
    });
    for (const id of players.slice(1))
      room = await call(
        "rooms:join",
        id,
        { version: room.version },
        { code: room.code },
      );
    return room;
  };
  const playing = async (players = ["u1", "u2"]) => {
    let room = await setup(players);
    room = await call(
      "rooms:start",
      "u1",
      { version: room.version },
      { code: room.code },
    );
    room = await roomCall(room, "rooms:select", "u1", { letter: "C" });
    return roomCall(room, "rooms:confirm", "u1", { letter: "C" });
  };
  const review = async () => {
    let room = await playing();
    room = await roomCall(room, "rooms:answers", "u1", {
      answers: ["Cinza", "Corsa", "Caqui"],
      final: true,
      sequence: 1,
    });
    room = await roomCall(room, "rooms:answers", "u2", {
      answers: ["cinza", "Camaro", ""],
      final: true,
      sequence: 1,
    });
    return roomCall(room, "rooms:stop");
  };
  const approve = async (room) => {
    for (let i = room.review.category; i < room.categories.length; i++) {
      for (const voter of room.participants) {
        const votes = Object.fromEntries(
          room.participants.map((id) => [
            `${id}:${i}`,
            {
              v: room.suggested[id][i],
              e: room.review.epochs[`${id}:${i}`] ?? 0,
            },
          ]),
        );
        room = await roomCall(room, "review:votes", voter, { votes });
      }
      if (i < room.categories.length - 1) {
        for (const voter of room.participants)
          room = await roomCall(room, "review:complete", voter);
      }
    }
    return room;
  };
  return {
    repo,
    service,
    call,
    sync,
    roomCall,
    setup,
    playing,
    review,
    approve,
  };
}
