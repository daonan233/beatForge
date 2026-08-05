import { createRouter, createWebHistory } from "vue-router";
import LibraryView from "./views/LibraryView.vue";
import EditorView from "./views/EditorView.vue";
import GameView from "./views/GameView.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "library", component: LibraryView },
    { path: "/editor/:songId", name: "editor", component: EditorView },
    { path: "/play/:songId/:difficulty", name: "game", component: GameView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
