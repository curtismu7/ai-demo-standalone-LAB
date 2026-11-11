// A plain hash link (the nav and pages live on hash routes; nothing re-renders through a router).
export function Link({ href, children, ...rest }) {
  return <a href={href} {...rest}>{children}</a>;
}
