import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCustomers } from '@/lib/hooks/useCustomers';
import type { Customer } from '@/lib/shared';

interface CustomerComboboxProps {
  customers: Customer[];
  value: string | null;
  onChange: (id: string | null) => void;
}

export function CustomerCombobox({ customers, value, onChange }: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const { addCustomer } = useCustomers();

  const selected = customers.find(c => c.id === value);
  const filtered = useMemo(
    () => customers.filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [customers, search],
  );

  function resetAndClose() {
    setAdding(false);
    setSearch('');
    setNewName('');
    setNewPhone('');
    setOpen(false);
  }

  async function submitNewCustomer() {
    if (!newName.trim()) return;
    const created = await addCustomer.mutateAsync({ name: newName.trim(), phone: newPhone.trim() || undefined });
    onChange(created.id);
    resetAndClose();
  }

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) {
          addCustomer.reset();
          setAdding(false);
          setSearch('');
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label="Customer"
            className="w-36 justify-between font-normal"
          />
        }
      >
        <span className="truncate">{selected?.name ?? 'No customer'}</span>
        <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        {adding ? (
          <div className="flex flex-col gap-2 p-3">
            <Input
              autoFocus
              placeholder="Customer name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              aria-label="New customer name"
            />
            <Input
              placeholder="Phone (optional)"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
              aria-label="New customer phone"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!newName.trim() || addCustomer.isPending}
                onClick={submitNewCustomer}
              >
                Add customer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => { addCustomer.reset(); setAdding(false); }}
              >
                Cancel
              </Button>
            </div>
            {addCustomer.error && <p className="text-sm text-destructive">{addCustomer.error.message}</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            <Input
              autoFocus
              placeholder="Search customers…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              aria-label="Search customers"
            />
            <div className="max-h-56 overflow-y-auto">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => { onChange(null); resetAndClose(); }}
              >
                <Check className={cn('h-4 w-4 shrink-0', value === null ? 'opacity-100' : 'opacity-0')} />
                No customer
              </button>
              {filtered.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => { onChange(c.id); resetAndClose(); }}
                >
                  <Check className={cn('h-4 w-4 shrink-0', value === c.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">No customer found.</p>
              )}
            </div>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Add customer
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
