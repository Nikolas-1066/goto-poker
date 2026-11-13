import type { Metadata } from "next";
import { ProfilePage } from "@/components/site/Account";

export const metadata: Metadata = { title: "Личный кабинет — ГОТО ПОКЕР" };

export default function Page() {
  return <ProfilePage />;
}
