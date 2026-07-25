import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, type LoginInput } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { branding } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';
import { PinInput } from '@/components/ui/pin-input';

export default function LoginForm() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { username: '', pin: '' },
  });

  async function onSubmit(data: LoginInput) {
    setFormError(null);
    try {
      await login(data.username, data.pin);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Invalid credentials');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to {branding.appName}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="login-username">Username</FieldLabel>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  placeholder="username"
                  aria-invalid={!!errors.username}
                  {...register('username')}
                />
                <FieldError errors={errors.username ? [errors.username] : undefined} />
              </Field>
              <Field>
                <FieldLabel htmlFor="login-pin">PIN</FieldLabel>
                <Controller
                  name="pin"
                  control={control}
                  render={({ field }) => (
                    <PinInput
                      id="login-pin"
                      value={field.value}
                      onChange={field.onChange}
                      aria-invalid={!!errors.pin}
                    />
                  )}
                />
                <FieldError errors={errors.pin ? [errors.pin] : undefined} />
              </Field>
            </FieldGroup>
            {formError && (
              <p role="alert" className="text-sm font-normal text-destructive">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting} className="self-stretch">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
