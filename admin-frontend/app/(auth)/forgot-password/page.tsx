"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (error) {
      setError(error.message ?? "Noget gik galt. Prøv igen.");
    } else {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-[calc(100dvh-6rem)] items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="items-center text-center">
            <MailCheck className="mb-2 h-10 w-10 text-muted-foreground" />
            <CardTitle className="text-lg md:text-xl">
              Tjek din indbakke
            </CardTitle>
            <CardDescription className="text-xs md:text-sm">
              Hvis kontoen eksisterer, har vi sendt et link til{" "}
              <span className="font-medium text-foreground">{email}</span>.
              Linket udløber om 1 time.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Link
              href="/login"
              className="text-sm underline underline-offset-4"
            >
              Tilbage til login
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-lg md:text-xl">
            Glemt adgangskode?
          </CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Indtast din e-mailadresse, så sender vi dig et link til at nulstille
            din adgangskode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="din@email.dk"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                "Send nulstillingslink"
              )}
            </Button>

            <p className="text-center text-sm">
              <Link href="/login" className="underline underline-offset-4">
                Tilbage til login
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
