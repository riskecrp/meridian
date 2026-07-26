import { redirect } from "next/navigation";

// Merged into /fm/operations/discord. Kept so existing links and bookmarks land
// in the right place rather than 404ing.
export default function Page() {
  redirect("/fm/operations/discord");
}
