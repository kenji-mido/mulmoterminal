import { Server as IOServer } from "socket.io";
import type { Server as HttpServer } from "node:http";

// Minimal socket.io pub/sub, modeled on mulmoclaude's server/events/pub-sub.
// Channel names are socket.io rooms — subscribe/unsubscribe map to
// socket.join / socket.leave, and publish broadcasts to the room.
// socket.io handles reconnect / heartbeat / transport for us.
// What a module that only ANNOUNCES needs. Depending on the whole createPubSub return type
// instead means every such module — and every test fake — has to grow a method it never
// calls each time this file gains one.
export interface Publisher {
  publish(channel: string, data: unknown): void;
}

export function createPubSub(server: HttpServer, isAllowedOrigin: (origin: string | undefined, remoteAddress: string | undefined) => boolean = () => true) {
  const io = new IOServer(server, {
    path: "/ws/pubsub",
    transports: ["websocket"],
    // Reject cross-origin connections so an untrusted website can't subscribe to
    // session activity. allowRequest covers the websocket handshake; cors covers
    // any polling/preflight.
    allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin, req.socket?.remoteAddress)),
    cors: {
      // Socket.IO hands this callback no request, so there is genuinely no peer to check —
      // spelled out rather than omitted. allowRequest above gates the actual handshake and
      // does see the socket, so this covers only polling/preflight.
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, undefined)),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", (channel) => {
      if (typeof channel === "string") void socket.join(channel);
    });
    socket.on("unsubscribe", (channel) => {
      if (typeof channel === "string") void socket.leave(channel);
    });
  });

  return {
    publish(channel: string, data: unknown) {
      io.to(channel).emit("data", { channel, data });
    },
    // How many sockets are in the room. A publish is fire-and-forget, so a caller that
    // NEEDS someone to act on the message (the phone asking the grid to open a terminal,
    // #831) has to check first — otherwise "no browser is open" is indistinguishable from
    // success, and the phone reports a launch that never happened.
    subscriberCount(channel: string): number {
      return io.sockets.adapter.rooms.get(channel)?.size ?? 0;
    },
    // Deliver to exactly ONE subscriber, and say whether anyone got it.
    //
    // `publish` broadcasts, which is right for the channels that announce a fact — a dir's
    // config changed, a session became active — since every tab reacting is the point and
    // reacting twice costs nothing. A message that asks for an ACTION is the opposite: with
    // two MulmoTerminal tabs open, a broadcast would have each of them open a terminal, so
    // one tap on the phone spawns as many PTYs as there are tabs.
    publishToOne(channel: string, data: unknown): boolean {
      const [first] = io.sockets.adapter.rooms.get(channel) ?? [];
      if (!first) return false;
      io.to(first).emit("data", { channel, data });
      return true;
    },
  };
}
