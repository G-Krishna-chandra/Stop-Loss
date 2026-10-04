// Public surface of src/cancel. Other modules import from here and nowhere deeper.
export { createCanceller, cleanDetail } from "./canceller.js";
export type { CancelHooks, CancelLog, Canceller, CancellerOptions } from "./canceller.js";
export { createKernelApi } from "./kernel.js";
export type { ExecuteResult, KernelApi, KernelSession } from "./kernel.js";
export { GENERIC_RECIPE, SERVICE_RECIPES, pickRecipe } from "./recipes.js";
export type { CancelRecipe, RecipeInput } from "./recipes.js";
