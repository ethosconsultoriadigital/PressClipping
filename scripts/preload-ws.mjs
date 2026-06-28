// Preload para Node < 22: @supabase/supabase-js (RealtimeClient) requiere un
// WebSocket global. Node 20 no lo trae nativo, así que lo inyectamos con "ws".
// Se carga vía NODE_OPTIONS=--import en CI y aplica a todos los subprocesos.
import ws from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws;
}
