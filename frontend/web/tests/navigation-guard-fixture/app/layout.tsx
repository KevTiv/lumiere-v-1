import "./globals.css"
import { NavigationGuardProvider } from "../../../../packages/ui/src/forms/navigation-guard-provider"

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body><NavigationGuardProvider>{children}</NavigationGuardProvider></body></html>
}
