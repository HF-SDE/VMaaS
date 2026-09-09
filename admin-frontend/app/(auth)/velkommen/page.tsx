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
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function SetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-lg md:text-xl text-destructive">
            Ugyldigt link
          </CardTitle>
          <CardDescription>
            Dette aktiveringslink er ugyldigt eller udløbet. Kontakt en
            administrator for at få sendt et nyt.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="max-w-md w-full">
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="mb-2 h-10 w-10 text-green-500" />
          <CardTitle className="text-lg md:text-xl">Konto aktiveret!</CardTitle>
          <CardDescription>
            Din adgangskode er oprettet. Du kan nu logge ind og komme i gang.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button asChild className="w-full">
            <Link href="/login">Gå til login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Adgangskoderne stemmer ikke overens.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Adgangskoden skal være mindst 8 tegn.");
      return;
    }

    setLoading(true);

    const { error } = await authClient.resetPassword({
      newPassword,
      token: token!,
    });

    setLoading(false);

    if (error) {
      if (error.status === 400 || error.status === 422) {
        setError(
          "Aktiveringslinket er udløbet eller ugyldigt. Kontakt en administrator.",
        );
      } else {
        setError(error.message ?? "Noget gik galt. Prøv igen.");
      }
    } else {
      setDone(true);
    }
  }

  return (
    <Card className="max-w-md w-full">
      <CardHeader>
        <CardTitle className="text-lg md:text-xl">
          Velkommen - opret din adgangskode
        </CardTitle>
        <CardDescription className="text-xs md:text-sm">
          Din konto er oprettet af en administrator. Vælg en adgangskode for at
          aktivere din konto og komme i gang.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-password">Adgangskode</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="Mindst 8 tegn"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Gentag adgangskode</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Gentag adgangskoden"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              "Aktiver konto"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Suspense>
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
