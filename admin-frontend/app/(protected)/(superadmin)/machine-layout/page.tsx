import { redirect } from "next/navigation"

/** There's no machine-layout index; the machine picker lives on /create-machine. */
export default function MachineLayoutIndexPage() {
  redirect("/create-machine")
}
