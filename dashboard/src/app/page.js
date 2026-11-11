import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { UI_COOKIE, pickUi } from "../lib/uiRoutes.js";
export default async function Home() {
  const c = await cookies();
  if (!c.get("meridian_session")) redirect("/login");
  redirect(`/${pickUi(c.get(UI_COOKIE)?.value)}`);
}
