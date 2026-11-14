import { Recipe } from "@/lib/types";
import { useState } from "react";

export function useRecipe() {
  const [title, setTitle] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState([]);
  const [steps, setSteps] = useState([]);
  
  
}