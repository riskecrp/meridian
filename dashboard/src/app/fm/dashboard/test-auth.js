"use server";
import { requireActor } from "../../../lib/requireActor.js";

// Test action — verifies requireActor() works correctly.
// You can call this from any client component to confirm auth is working.
export async function testAuth() {
  try {
    const actor = await requireActor(1);
    return {
      ok: true,
      actor: {
        id: actor.id,
        name: actor.name,
        level: actor.level,
        teamName: actor.teamName,
      },
      message: `Authenticated as ${actor.name} (L${actor.level})`,
    };
  } catch (e) {
    return {
      ok: false,
      code: e.code || 'UNKNOWN',
      message: e.message,
    };
  }
}

export async function testAuthLevel3() {
  try {
    const actor = await requireActor(3);
    return { ok: true, message: `L3 access confirmed for ${actor.name}` };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }
}
