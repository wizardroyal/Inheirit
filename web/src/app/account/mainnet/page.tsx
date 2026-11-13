// The mainnet page inside the account area, so the side bar stays (the public one is /mainnet).
import MainnetPage from "@/app/mainnet/page";

export const metadata = { title: "Inheirit on mainnet" };

export default function AccountMainnetPage() {
  return <MainnetPage />;
}
