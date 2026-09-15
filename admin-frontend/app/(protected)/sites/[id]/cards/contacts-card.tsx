import type { ReactNode } from "react"
import { Mail, Phone, User } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ContactsCardProps = {
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  className?: string
}

/** `tel:` wants the digits, not the spacing people write a number with. */
function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`
}

function ContactLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className="flex w-fit items-center gap-2 hover:underline"
      // The address and the number are the site's own, but neither is
      // guaranteed to be well-formed — let the browser decide what it can open.
      rel="nofollow"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{children}</span>
    </a>
  )
}

/** Who to reach at the site, as one click each: a mail client or a dialler. */
export function ContactsCard({
  contactName,
  contactEmail,
  contactPhone,
  className,
}: ContactsCardProps) {
  const hasContact = Boolean(contactName || contactEmail || contactPhone)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Contact</CardTitle>
      </CardHeader>
      <CardContent>
        {hasContact ? (
          <>
            {contactName && (
              <p className="flex items-center gap-2">
                <User className="size-4 text-muted-foreground" />
                {contactName}
              </p>
            )}
            {contactEmail && (
              <ContactLink
                href={`mailto:${contactEmail}`}
                icon={<Mail className="size-4" />}
              >
                {contactEmail}
              </ContactLink>
            )}
            {contactPhone && (
              <ContactLink
                href={telHref(contactPhone)}
                icon={<Phone className="size-4" />}
              >
                {contactPhone}
              </ContactLink>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">
            No contact details for this site yet.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
