import { redirect } from "next/navigation";
import { cookies } from "next/headers";
export default async function Home() {
  const c = await cookies();
  redirect(c.get("meridian_session") ? "/v2" : "/login");
}
