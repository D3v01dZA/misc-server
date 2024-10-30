FROM eclipse-temurin:17-jdk-alpine
WORKDIR /
COPY ./build/libs/misc-server-0.0.1-SNAPSHOT.jar app.jar
RUN mkdir /data/
RUN mkdir /data/cards/
RUN mkdir /data/results/
COPY ./cards/. /data/cards/
WORKDIR /data/
ENTRYPOINT ["java","-jar","/app.jar"]