export function LogoutButton() {
  return (
    <form action="/api/affiliate/logout" method="post">
      <button
        type="submit"
        className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );
}
