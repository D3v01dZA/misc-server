package net.caltona.miscserver;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.yaml.snakeyaml.Yaml;

import java.io.*;
import java.util.*;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;
import java.util.stream.Collectors;

@Slf4j
@RestController
public class FlashCardController {

    private static final Random RANDOM = new Random();

    private final Map<String, List<Combo>> combosByName;

    private final Map<String, List<Integer>> weightsByName;

    private final Map<String, Writer> outputsByName;

    public FlashCardController(@Value("${misc.cards.combosdirectory}") String directory,
                               @Value("${misc.cards.resultsdirectory}") String resultsDirectory) throws IOException {
        this.combosByName = new TreeMap<>();
        this.weightsByName = new HashMap<>();
        this.outputsByName = new HashMap<>();
        File dir = new File(directory);
        if (!dir.exists() || !dir.isDirectory()) {
            throw new IllegalStateException(String.format("Directory %s does not exist", directory));
        }
        File[] files = dir.listFiles((__, name) -> name.endsWith(".yaml"));
        if (files == null || files.length == 0) {
            throw new IllegalStateException(String.format("Directory %s contains no files", directory));
        }
        Yaml yaml = new Yaml();
        for (File file : files) {
            Container loaded = yaml.loadAs(new FileReader(file), Container.class);
            if (loaded == null) {
                throw new IllegalStateException(String.format("Null container for %s", file.getName()));
            }
            loaded.check();

            String key = file.getName().replace(".yaml", "");
            combosByName.put(key, loaded.getCombos());

            List<Integer> weights = loaded.getCombos().stream().map(__ -> 1).collect(Collectors.toCollection(ArrayList::new));
            weightsByName.put(key, weights);

            String weightsFile = resultsDirectory + "/" + key + ".dmp";
            Writer writer = new Writer(weightsFile);
            outputsByName.put(key, writer);
            writer.read((question, difficulty) -> addWeight(key, weights, question, difficulty));
        }
    }

    @GetMapping(value = "/card")
    public String card(@RequestParam(required = false) String list,
                       @RequestParam(required = false) Integer question,
                       @RequestParam(required = false) Integer difficulty) {
        if (list == null) {
            return listHTML();
        }
        List<Combo> combos = combosByName.get(list);
        if (combos == null) {
            return listHTML();
        }
        return cardHTML(list, combos, weightsByName.get(list), outputsByName.get(list), question, difficulty);
    }

    private String listHTML() {
        log.info("List");
        return String.format("<html>" +
                        "   <head>" +
                        "       <title>Flash Card List</title>" +
                        "   </head>" +
                        "   <body>" +
                        "       <div style='max-width:95%%;margin:auto;text-align:center'>" +
                        "           <h2>Lists</h2>" +
                        "           %s" +
                        "           <script>" +
                        "               function redirect(url) {" +
                        "                   const params = new URLSearchParams(window.location.search);" +
                        "                   params.set('list', url);" +
                        "                   window.location.search = params;" +
                        "               }" +
                        "           </script>" +
                        "       </div>" +
                        "   </body>" +
                        "</html>",
                combosByName.keySet().stream()
                        .map(list -> String.format("<button onclick='redirect(\"%s\")'>%s</button>", list, capitalize(list)))
                        .collect(Collectors.joining())
        );
    }

    private String cardHTML(String list, List<Combo> combos, List<Integer> weights, Writer output, Integer question, Integer difficulty) {
        log.info("List {} card {} difficulty {}", list, question, difficulty);
        List<String> errors = getErrors(combos, question, difficulty);
        if (question != null && difficulty != null && errors.isEmpty()) {
            addWeight(list, weights, question, difficulty);
            output.write(question, difficulty);
        }
        int selected = applyWeights(weights);
        Combo combo = combos.get(selected);
        return String.format("<html>" +
                        "   <head>" +
                        "       <title>Flash Card Test - %s</title>" +
                        "   </head>" +
                        "   <body>" +
                        "       <div style='max-width:%%;margin:auto;text-align:center'>" +
                        "           <h2>%s</h2>" +
                        "           <button id='ansbtn' onclick='answer()'>Answer</button>" +
                        "           <div id='ans' style='display:none'>" +
                        "               <h3>%s</h3>" +
                        "               <button id='wrong' onclick='redirect(1)'>Wrong</button>" +
                        "               <button id='hard' onclick='redirect(2)'>Hard</button>" +
                        "               <button id='easy' onclick='redirect(3)'>Easy</button>" +
                        "           </div>" +
                        "           <p>%s</p>" +
                        "           <script>" +
                        "               function answer() {" +
                        "                   document.querySelector('#ansbtn').style.display = 'none';" +
                        "                   document.querySelector('#ans').style.display = 'block';" +
                        "               }" +
                        "               function redirect(difficulty) {" +
                        "                   const params = new URLSearchParams(window.location.search);" +
                        "                   params.set('question', '%s');" +
                        "                   params.set('difficulty', difficulty);" +
                        "                   window.location.search = params;" +
                        "               }" +
                        "           </script>" +
                        "       </div>" +
                        "   </body>" +
                        "</html>",
                capitalize(list),
                combo.getQuestion(),
                "<p>" + String.join("<br/>", combo.getAnswers()) + "</p>",
                errors.isEmpty() ? "" : "<h2>Errors</h2>" + "<p>" + String.join("<br/>", errors) + "</p>",
                selected
        );
    }

    private static void addWeight(String list, List<Integer> weights, Integer question, Integer difficulty) {
        int addedWeight = -1;
        if (difficulty == 1) {
            addedWeight = 0; // If wrong don't make the question any less likely
        }
        if (difficulty == 2) {
            addedWeight = 3; // If hard make the question less likely
        }
        if (difficulty == 3) {
            addedWeight = 15; // If easy make the question way less likely
        }
        int currentWeight = weights.get(question);
        log.info("List {} adding {} weight to question {}", list, addedWeight, currentWeight);
        weights.set(question, currentWeight + addedWeight);
    }

    private int applyWeights(List<Integer> weights) {
        int modifier = weights.stream()
                .mapToInt(__ -> __)
                .max()
                .getAsInt();
        List<Integer> computed = weights.stream()
                .map(weight -> Math.abs(modifier - weight) + 1)
                .toList();
        int sum = computed.stream()
                .mapToInt(__ -> __)
                .sum();
        int selected = RANDOM.nextInt(sum);
        int current = 0;
        for (int i = 0; i < computed.size(); i++) {
            current += computed.get(i);
            if (current > selected) {
                return i;
            }
        }
        throw new IllegalStateException("Could not compute a weight");
    }

    private String capitalize(final String line) {
        return Character.toUpperCase(line.charAt(0)) + line.substring(1);
    }

    private static List<String> getErrors(List<Combo> combos, Integer question, Integer difficulty) {
        List<String> errors = new ArrayList<>();
        if (difficulty != null || question != null) {
            if (question == null) {
                errors.add("Question was null");
            }
            if (question != null && question < 0) {
                errors.add("Question was < 0");
            }
            if (question != null && question > combos.size() - 1) {
                errors.add("Question was > " + (combos.size() - 1));
            }
            if (difficulty == null) {
                errors.add("Difficulty was null");
            }
            if (difficulty != null && difficulty < 1) {
                errors.add("Difficulty was < 1");
            }
            if (difficulty != null && difficulty > 3) {
                errors.add("Difficulty was > 3");
            }
        }
        return errors;
    }

    @AllArgsConstructor
    public class Writer {

        private String file;

        public void write(int question, int difficulty) {
            File actual = new File(file);
            if (!actual.exists()) {
                try {
                    if (!actual.createNewFile()) {
                        throw new IllegalStateException("Could not create " + file);
                    }
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
            try (FileWriter fileWriter = new FileWriter(actual, true)) {
                fileWriter.write(question + "," + difficulty + "\n");
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
        }

        public void read(BiConsumer<Integer, Integer> questionDifficultyConsumer) throws IOException {
            File actual = new File(file);
            if (actual.exists()) {
                try (BufferedReader reader = new BufferedReader(new FileReader(actual))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        boolean error = false;
                        try {
                            if (line.contains(",")) {
                                String[] split = line.split(",");
                                if (split.length != 2) {
                                    error = true;
                                }
                                int question = Integer.parseInt(split[0]);
                                int weight = Integer.parseInt(split[1]);
                                questionDifficultyConsumer.accept(question, weight);
                            } else if (!line.isEmpty()) {
                                error = true;
                            }
                        } catch (NumberFormatException ex) {
                            error = true;
                        }
                        if (error) {
                            log.warn("Unknown line {} encountered while reading {}", line, file);
                        }
                    }
                }
            }
        }

    }

    @Data
    public static class Container {

        private List<Combo> combos;

        private void check() {
            if (combos == null || combos.isEmpty()) {
                throw new IllegalStateException("Empty combos");
            }
            for (Combo combo : combos) {
                if (combo == null) {
                    throw new IllegalStateException("Null combo");
                }
                combo.check();
            }
        }

    }

    @Data
    public static class Combo {

        private String question;
        private List<String> answers;

        private void check() {
            if (question == null || question.trim().isEmpty()) {
                throw new IllegalStateException("Null question");
            }
            if (answers == null || answers.isEmpty()) {
                throw new IllegalStateException("Empty combos");
            }
            for (String answer : answers) {
                if (answer == null || answer.trim().isEmpty()) {
                    throw new IllegalStateException("Null answer");
                }
            }
        }

    }

}
