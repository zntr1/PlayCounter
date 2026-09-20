import { GlobalSearch } from "../shell/GlobalSearch";
import { SidebarSources } from "../shell/SidebarSources";
import { MyGamesView } from "./MyGamesView";

/* Test-only composition. The library's search field lives in the window's
   title bar and its source tabs in the sidebar, so a test that renders the
   view alone would have neither. This puts the three pieces together the way
   App.tsx does, without the rest of the shell. */
export function LibraryTestShell() {
  return (
    <>
      <GlobalSearch />
      <SidebarSources />
      <MyGamesView />
    </>
  );
}
