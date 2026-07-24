import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, type LoginInput } from '@/lib/shared';
import { useAuth } from '@/lib/auth/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field';

export default function LoginForm() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { username: '', password: '' },
  });

  async function onSubmit(data: LoginInput) {
    setFormError(null);
    try {
      await login(data.username, data.password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Invalid credentials');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Cue Room</CardTitle>
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
                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                <FieldError errors={errors.password ? [errors.password] : undefined} />
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
