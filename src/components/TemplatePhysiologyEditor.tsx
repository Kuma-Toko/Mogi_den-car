"use client";

import { useState } from "react";
import { PhysiologySliders } from "./PhysiologySliders";
import { ImprovementSpeedChart } from "./ImprovementSpeedChart";
import type { PhysiologyParams } from "@/lib/physiology";

export function TemplatePhysiologyEditor({ initial }: { initial: PhysiologyParams }) {
  const [values, setValues] = useState(initial);

  return (
    <>
      <ImprovementSpeedChart slider={values.improvementSpeedSlider} savedSlider={initial.improvementSpeedSlider} />
      <PhysiologySliders initial={initial} onChange={setValues} />
    </>
  );
}
