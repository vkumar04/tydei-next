"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { contactSchema, type ContactInput } from "@/lib/validators"
import { submitContactForm } from "@/lib/actions/contact"

export function ContactForm() {
  const [isPending, startTransition] = useTransition()
  const [sent, setSent] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
  })

  function onSubmit(data: ContactInput) {
    startTransition(async () => {
      const result = await submitContactForm(data)
      if (result.ok) {
        setSent(true)
        reset()
        toast.success("Message sent — we'll be in touch shortly.")
      } else {
        toast.error(result.error ?? "Something went wrong. Please try again.")
      }
    })
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-10 text-center">
        <CheckCircle2 className="size-12 text-primary" aria-hidden="true" />
        <h2 className="text-xl font-semibold">Thanks for reaching out</h2>
        <p className="max-w-md text-muted-foreground">
          Your message is on its way to our team. We typically respond within one
          business day.
        </p>
        <Button variant="outline" onClick={() => setSent(false)}>
          Send another message
        </Button>
      </div>
    )
  }

  return (
    // method="post": a pre-hydration submit posts fields in the body, not the URL.
    <form onSubmit={handleSubmit(onSubmit)} method="post" className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="contact-name">Name</Label>
          <Input id="contact-name" placeholder="Jane Doe" {...register("name")} />
          {errors.name && (
            <p className="text-xs text-destructive">{errors.name.message}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact-email">Work email</Label>
          <Input
            id="contact-email"
            type="email"
            placeholder="you@hospital.org"
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-company">
          Organization <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="contact-company"
          placeholder="Lighthouse Surgical Center"
          {...register("company")}
        />
        {errors.company && (
          <p className="text-xs text-destructive">{errors.company.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-message">How can we help?</Label>
        <Textarea
          id="contact-message"
          rows={6}
          placeholder="Tell us about your contracts, rebate programs, or what you're hoping to streamline."
          {...register("message")}
        />
        {errors.message && (
          <p className="text-xs text-destructive">{errors.message.message}</p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={isPending}>
        {isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
        Send message
      </Button>
    </form>
  )
}
